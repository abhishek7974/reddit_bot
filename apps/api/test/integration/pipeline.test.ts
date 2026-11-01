import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.ts';
import { ProviderError } from '../../src/lib/errors.ts';
import { runDiscovery } from '../../src/services/discovery.ts';
import { analyzeConversation } from '../../src/services/pipeline.ts';
import { processPublishAttempt } from '../../src/services/publish.ts';
import { purgeExpired } from '../../src/services/retention.ts';
import { Client, appFor, makeCtx, resetDb, seedBase, testDb, type TestContext } from '../helpers.ts';

const db = testDb();

async function discoverAndAnalyze(ctx: TestContext) {
  const result = await runDiscovery(ctx, null);
  for (const id of [...ctx.queues.analysis]) await analyzeConversation(ctx, id);
  ctx.queues.analysis = [];
  return result;
}

const convByExternal = (externalPostId: string) =>
  db.conversation.findFirstOrThrow({ where: { externalPostId }, include: { drafts: true } });

describe('discovery → analysis → drafting (DEMO, synthetic data)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    await resetDb(db);
    await seedBase(db, { paused: true });
    ctx = makeCtx();
  });

  it('discovers synthetic conversations, filters removed posts and deduplicates', async () => {
    const first = await runDiscovery(ctx, null);
    expect(first.created).toBe(11); // 12 fixtures minus one removed post
    expect(first.filtered).toBe(1);
    const second = await runDiscovery(ctx, null);
    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(11);
    expect(await db.conversation.count()).toBe(11);
    expect(await db.conversation.count({ where: { dataSource: 'REDDIT' } })).toBe(0);
  });

  it('respects keyword exclusions and disabled communities', async () => {
    await db.discoverySettings.update({ where: { id: 'discovery' }, data: { exclusions: ['salary'] } });
    await db.subredditPolicy.update({ where: { communityName: 'demo_unreviewed' }, data: { discoveryEnabled: false } });
    await runDiscovery(ctx, null);
    expect(await db.conversation.count({ where: { externalPostId: 'syn_001' } })).toBe(0);
    expect(await db.conversation.count({ where: { communityName: 'demo_unreviewed' } })).toBe(0);
  });

  it('classifies, drafts, and applies policy per community', async () => {
    await discoverAndAnalyze(ctx);

    const offTopic = await convByExternal('syn_008');
    expect(offTopic.processingStatus).toBe('SKIPPED');
    expect(offTopic.drafts).toHaveLength(0);

    const salary = await convByExternal('syn_001');
    expect(salary.topic).toBe('SALARY_NEGOTIATION');
    expect(salary.drafts).toHaveLength(1);
    // Paused -> held even though the community allows automation.
    expect(salary.eligibilityStatus).toBe('HOLD_FOR_REVIEW');

    const injection = await convByExternal('syn_006');
    expect((injection.understanding as { promptInjectionSuspected: boolean }).promptInjectionSuspected).toBe(true);
    expect(injection.eligibilityStatus).not.toBe('ELIGIBLE_FOR_AUTOMATION');

    const sensitive = await convByExternal('syn_007');
    expect((sensitive.understanding as { needsSensitiveHandling: boolean }).needsSensitiveHandling).toBe(true);
    expect(sensitive.eligibilityStatus).not.toBe('ELIGIBLE_FOR_AUTOMATION');

    // Every generated draft identifies its model and was audited.
    const drafts = await db.replyDraft.findMany();
    expect(drafts.every((d) => d.model?.startsWith('mock:'))).toBe(true);
    expect(await db.auditEvent.count({ where: { action: 'draft.generated' } })).toBe(drafts.length);
    // Token usage is recorded for cost monitoring.
    expect(await db.llmUsage.count()).toBeGreaterThan(0);
    expect(ctx.queues.publish).toHaveLength(0);
  });

  it('auto-publishes (simulated) only where every check passes', async () => {
    await db.systemState.update({ where: { id: 'system' }, data: { globalPause: false } });
    await discoverAndAnalyze(ctx);
    const queued = await db.publishAttempt.findMany({ where: { status: 'PENDING' }, include: { replyDraft: { include: { conversation: true } } } });
    expect(queued.length).toBeGreaterThan(0);
    for (const a of queued) {
      // Only the community that is approved, current and automation-enabled.
      expect(a.replyDraft.conversation.communityName).toBe('demo_careeradvice');
      expect(a.simulated).toBe(true);
    }
    // Stale (demo_cscareers), no-automation (demo_resumes) and unreviewed communities are held.
    for (const community of ['demo_cscareers', 'demo_resumes', 'demo_unreviewed']) {
      const eligible = await db.conversation.count({ where: { communityName: community, eligibilityStatus: 'ELIGIBLE_FOR_AUTOMATION' } });
      expect(eligible, community).toBe(0);
    }
    for (const a of queued) await processPublishAttempt(ctx, a.id, { finalAttempt: false });
    const done = await db.publishAttempt.findMany({ where: { id: { in: queued.map((q) => q.id) } } });
    expect(done.every((d) => d.status === 'SIMULATED' && d.externalCommentId?.startsWith('mock_c_'))).toBe(true);
    // The disclosure footer was appended to everything "posted".
    expect(ctx.mockReddit.submitted.every((s) => s.text.includes('I am an automated assistant.'))).toBe(true);
  });

  it('works in DRAFT_ONLY mode without Reddit credentials, and never publishes', async () => {
    const draftOnly = makeCtx({ APP_MODE: 'DRAFT_ONLY' });
    await db.systemState.update({ where: { id: 'system' }, data: { globalPause: false } });
    await discoverAndAnalyze(draftOnly);
    expect(await db.replyDraft.count()).toBeGreaterThan(0);
    expect(await db.publishAttempt.count({ where: { status: { in: ['PENDING', 'SUCCEEDED', 'SIMULATED'] } } })).toBe(0);
    const app = await appFor(draftOnly);
    const c = new Client(app);
    await c.login('admin@test.local');
    const draft = await db.replyDraft.findFirstOrThrow();
    await c.req('POST', `/api/drafts/${draft.id}/approve`, {});
    const res = await c.req('POST', `/api/drafts/${draft.id}/publish`);
    expect(res.json().queued).toBe(false);
    expect(res.json().policy.checks.find((x: { id: string }) => x.id === 'mode_target').outcome).toBe('FAIL');
    await app.close();
  });

  it('marks drafts with fabricated anecdotes or forced brand claims as blocked', async () => {
    await discoverAndAnalyze(ctx);
    const app = await appFor(ctx);
    const c = new Client(app);
    await c.login('reviewer@test.local');
    const draft = await db.replyDraft.findFirstOrThrow({ where: { conversation: { communityName: 'demo_careeradvice' } } });

    const anecdote = await c.req('POST', `/api/drafts/${draft.id}/approve`, {
      body: 'When I was hiring at my last company, I always negotiated. CareerConnect will get you a better salary.',
    });
    expect(anecdote.statusCode).toBe(200);
    const detectors = anecdote.json().detectorFindings.map((f: { detector: string }) => f.detector);
    expect(detectors).toEqual(expect.arrayContaining(['personal_anecdote', 'promotion', 'unverified_brand_claim']));
    expect(anecdote.json().policy.decision).not.toBe('ELIGIBLE_FOR_AUTOMATION');
    await app.close();
  });
});

describe('publication guardrails', () => {
  let ctx: TestContext;
  let app: App;
  let admin: Client;
  let draftId: string;

  beforeEach(async () => {
    await resetDb(db);
    await seedBase(db, { paused: true });
    ctx = makeCtx();
    await discoverAndAnalyze(ctx);
    app = await appFor(ctx);
    admin = new Client(app);
    await admin.login('admin@test.local');
    const d = await db.replyDraft.findFirstOrThrow({ where: { conversation: { externalPostId: 'syn_001' } } });
    draftId = d.id;
    await admin.req('POST', `/api/drafts/${draftId}/approve`, { note: 'looks good' });
  });
  afterAll(async () => {
    await app?.close();
  });

  const resume = () => admin.req('POST', '/api/admin/publishing/resume', { reason: 'ready to test' });

  it('blocks publication while paused and records the attempt', async () => {
    const res = await admin.req('POST', `/api/drafts/${draftId}/publish`);
    expect(res.statusCode).toBe(200);
    expect(res.json().queued).toBe(false);
    expect(res.json().policy.reasons.join(' ')).toMatch(/paused/i);
    expect(await db.publishAttempt.count({ where: { replyDraftId: draftId, status: 'BLOCKED' } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'publish.blocked' } })).toBeGreaterThan(0);
  });

  it('publishes an approved draft once; duplicate requests cannot double-post', async () => {
    await resume();
    const key = { 'idempotency-key': 'key-123456' };
    const first = await admin.req('POST', `/api/drafts/${draftId}/publish`, undefined, key);
    expect(first.json().queued).toBe(true);
    // Same key: idempotent replay, no new attempt.
    const replay = await admin.req('POST', `/api/drafts/${draftId}/publish`, undefined, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().message).toMatch(/Duplicate request/);
    // Different key while queued: conflict.
    const other = await admin.req('POST', `/api/drafts/${draftId}/publish`, undefined, { 'idempotency-key': 'key-abcdefgh' });
    expect(other.statusCode).toBe(409);
    expect(ctx.queues.publish).toHaveLength(1);

    const attemptId = ctx.queues.publish[0]!;
    expect((await processPublishAttempt(ctx, attemptId, { finalAttempt: false })).kind).toBe('succeeded');
    // Re-running the same job is a no-op.
    expect((await processPublishAttempt(ctx, attemptId, { finalAttempt: false })).kind).toBe('skipped');
    expect(ctx.mockReddit.submitted).toHaveLength(1);

    // A second draft for the same conversation can never be published.
    const gen = await admin.req('POST', `/api/conversations/${(await db.replyDraft.findUniqueOrThrow({ where: { id: draftId } })).conversationId}/generate-draft`);
    expect(gen.statusCode).toBe(409);
    const after = await admin.req('POST', `/api/drafts/${draftId}/publish`, undefined, { 'idempotency-key': 'key-zzzzzzzz' });
    expect(after.json().queued).toBe(false);
    expect(after.json().policy.decision).toBe('SKIP');
  });

  it('kill switch removes queued jobs and the worker re-checks before submitting', async () => {
    await resume();
    await admin.req('POST', `/api/drafts/${draftId}/publish`);
    const attemptId = ctx.queues.publish[0]!;
    const paused = await admin.req('POST', '/api/admin/publishing/pause', { reason: 'incident drill' });
    expect(paused.json()).toMatchObject({ globalPause: true, removedJobs: 1 });
    expect(ctx.queues.publish).toHaveLength(0);
    // Even if a job slipped through, execution is blocked.
    expect((await processPublishAttempt(ctx, attemptId, { finalAttempt: false })).kind).toBe('skipped');
    await db.publishAttempt.update({ where: { id: attemptId }, data: { status: 'PENDING' } });
    expect((await processPublishAttempt(ctx, attemptId, { finalAttempt: false })).kind).toBe('blocked');
    expect(ctx.mockReddit.submitted).toHaveLength(0);
  });

  it('resume never overrides missing authorization', async () => {
    const live = makeCtx({ APP_MODE: 'LIVE' }, { livePublisher: ctx.mockReddit });
    const liveApp = await appFor(live);
    const c = new Client(liveApp);
    await c.login('admin@test.local');
    const state = (await c.req('POST', '/api/admin/publishing/resume', { reason: 'try to force it' })).json();
    expect(state.globalPause).toBe(false);
    expect(state.blockedReasons.join(' ')).toMatch(/Commercial-use approval is UNKNOWN/);
    await liveApp.close();
  });

  it('retries transient failures without double-posting, then trips the circuit breaker', async () => {
    await resume();
    await admin.req('POST', `/api/drafts/${draftId}/publish`);
    const attemptId = ctx.queues.publish[0]!;

    // Ambiguous failure: the comment landed but the client saw a network error.
    ctx.mockReddit.submitThenFailNetwork = true;
    const r1 = await processPublishAttempt(ctx, attemptId, { finalAttempt: false });
    expect(r1.kind).toBe('retry');
    const r2 = await processPublishAttempt(ctx, attemptId, { finalAttempt: false });
    expect(r2).toMatchObject({ kind: 'succeeded' });
    expect(ctx.mockReddit.submitted).toHaveLength(1); // recovered existing comment, no second post
  });

  it('respects server-provided retry hints and pauses after repeated errors', async () => {
    await resume();
    await admin.req('POST', `/api/drafts/${draftId}/publish`);
    const attemptId = ctx.queues.publish[0]!;
    ctx.mockReddit.failNextSubmit(
      new ProviderError('RATE_LIMITED', '429', true, 90_000),
      new ProviderError('SERVER', '503', true),
      new ProviderError('SERVER', '503', true),
    );
    const r = await processPublishAttempt(ctx, attemptId, { finalAttempt: false });
    expect(r).toMatchObject({ kind: 'retry' });
    expect((r as { error: ProviderError }).error.retryAfterMs).toBe(90_000);
    await processPublishAttempt(ctx, attemptId, { finalAttempt: false });
    await processPublishAttempt(ctx, attemptId, { finalAttempt: false });
    const state = await db.systemState.findUniqueOrThrow({ where: { id: 'system' } });
    expect(state.globalPause).toBe(true);
    expect(state.pauseReason).toMatch(/3 consecutive publish errors/);
    expect(await db.publishAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ status: 'BLOCKED' });
  });

  it('does not retry permanent errors and pauses on authorization errors', async () => {
    await resume();
    await admin.req('POST', `/api/drafts/${draftId}/publish`);
    const attemptId = ctx.queues.publish[0]!;
    ctx.mockReddit.failNextSubmit(new ProviderError('FORBIDDEN', '403 banned', false));
    const r = await processPublishAttempt(ctx, attemptId, { finalAttempt: false });
    expect(r.kind).toBe('failed');
    expect(await db.publishAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ status: 'FAILED_PERMANENT', errorCategory: 'FORBIDDEN' });
    expect((await db.systemState.findUniqueOrThrow({ where: { id: 'system' } })).globalPause).toBe(true);
  });

  it('a rejection after queueing stops publication', async () => {
    await resume();
    await admin.req('POST', `/api/drafts/${draftId}/publish`);
    const attemptId = ctx.queues.publish[0]!;
    await admin.req('POST', `/api/drafts/${draftId}/reject`, { reason: 'changed my mind' });
    expect((await processPublishAttempt(ctx, attemptId, { finalAttempt: false })).kind).toBe('blocked');
    expect(ctx.mockReddit.submitted).toHaveLength(0);
  });
});

describe('LIVE mode gating (mocked Reddit, never real)', () => {
  beforeEach(async () => {
    await resetDb(db);
    await seedBase(db);
  });

  async function liveDraft(ctx: TestContext) {
    const conv = await db.conversation.create({
      data: {
        externalPostId: 'syn_001', // exists in the mock provider; stored as REDDIT for this test
        dataSource: 'REDDIT',
        communityName: 'demo_careeradvice',
        minimalPermittedContext: { title: 'How do I negotiate salary?', excerpt: 'Offer is low, should I counter?', permalink: null, topComments: [] },
        retentionExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const { understandConversation, generateDraft } = await import('../../src/services/pipeline.ts');
    await understandConversation(ctx, conv.id);
    return generateDraft(ctx, conv.id, null);
  }

  const limits = { PUBLISH_MAX_PER_HOUR: '2', PUBLISH_MAX_PER_DAY: '5', PUBLISH_MAX_PER_COMMUNITY_PER_DAY: '1', REDDIT_CLIENT_ID: 'a', REDDIT_CLIENT_SECRET: 'b', REDDIT_REFRESH_TOKEN: 'c', REDDIT_USER_AGENT: 'd' };

  it('holds everything while commercial approval is missing', async () => {
    const mock = makeCtx().mockReddit;
    const ctx = makeCtx({ APP_MODE: 'LIVE', ...limits }, { livePublisher: mock, discovery: mock });
    const d = await liveDraft(ctx);
    expect(d.policyDecision).toBe('HOLD_FOR_REVIEW');
    expect(ctx.queues.publish).toHaveLength(0);
  });

  it('fails closed when rate limits are not configured', async () => {
    await db.platformAuthorization.update({ where: { id: 'platform' }, data: { apiAccessAuthorized: 'APPROVED', commercialUseApproved: 'APPROVED', accountRegisteredAndLabeled: 'APPROVED' } });
    const mock = makeCtx().mockReddit;
    const ctx = makeCtx({ APP_MODE: 'LIVE', REDDIT_CLIENT_ID: 'a', REDDIT_CLIENT_SECRET: 'b', REDDIT_REFRESH_TOKEN: 'c', REDDIT_USER_AGENT: 'd' }, { livePublisher: mock });
    const d = await liveDraft(ctx);
    expect(d.policyDecision).toBe('HOLD_FOR_REVIEW');
  });

  it('publishes through the live path only when everything is authorized, then enforces per-community limits', async () => {
    await db.platformAuthorization.update({ where: { id: 'platform' }, data: { apiAccessAuthorized: 'APPROVED', commercialUseApproved: 'APPROVED', accountRegisteredAndLabeled: 'APPROVED' } });
    const mock = makeCtx().mockReddit;
    const ctx = makeCtx({ APP_MODE: 'LIVE', ...limits }, { livePublisher: mock });
    const d = await liveDraft(ctx);
    expect(d.policyDecision).toBe('ELIGIBLE_FOR_AUTOMATION');
    const attemptId = ctx.queues.publish[0]!;
    const out = await processPublishAttempt(ctx, attemptId, { finalAttempt: false });
    expect(out).toMatchObject({ kind: 'succeeded', simulated: false });
    expect(await db.publishAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ status: 'SUCCEEDED', simulated: false });

    // Per-community daily cap (1) is now reached for any other conversation in the same community.
    const conv2 = await db.conversation.create({
      data: {
        externalPostId: 'syn_004', dataSource: 'REDDIT', communityName: 'demo_careeradvice',
        minimalPermittedContext: { title: 'Recruiter ghosted me after final round, follow up?', excerpt: 'It has been 9 days. Should I email again?', permalink: null, topComments: [] },
        retentionExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const { understandConversation, generateDraft } = await import('../../src/services/pipeline.ts');
    await understandConversation(ctx, conv2.id);
    const d2 = await generateDraft(ctx, conv2.id, null);
    const pe = (await db.replyDraft.findUniqueOrThrow({ where: { id: d2.id } })).policyEvaluation as { checks: { id: string; outcome: string }[] };
    expect(pe.checks.find((c) => c.id === 'rate_limits')?.outcome).toBe('FAIL');
  });

  it('skips posts removed upstream at execution time', async () => {
    await db.platformAuthorization.update({ where: { id: 'platform' }, data: { apiAccessAuthorized: 'APPROVED', commercialUseApproved: 'APPROVED', accountRegisteredAndLabeled: 'APPROVED' } });
    const mock = makeCtx().mockReddit;
    const ctx = makeCtx({ APP_MODE: 'LIVE', ...limits }, { livePublisher: mock });
    await liveDraft(ctx);
    const attemptId = ctx.queues.publish[0]!;
    const attempt = await db.publishAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { replyDraft: true } });
    await db.conversation.update({ where: { id: attempt.replyDraft.conversationId }, data: { externalPostId: 'syn_012' } }); // removed fixture
    expect((await processPublishAttempt(ctx, attemptId, { finalAttempt: false })).kind).toBe('blocked');
    expect(mock.submitted).toHaveLength(0);
  });
});

describe('data retention and deletion', () => {
  beforeEach(async () => {
    await resetDb(db);
    await seedBase(db, { paused: true });
  });

  it('purges Reddit-derived content after the retention period', async () => {
    const ctx = makeCtx();
    await discoverAndAnalyze(ctx);
    expect(await purgeExpired(ctx)).toBe(0);
    const later = makeCtx({}, { now: () => new Date(Date.now() + 31 * 86_400_000) });
    const purged = await purgeExpired(later);
    expect(purged).toBe(11);
    const convs = await db.conversation.findMany();
    expect(convs.every((c) => c.minimalPermittedContext === null && c.understanding === null && c.processingStatus === 'PURGED')).toBe(true);
    expect(await db.replyDraft.count()).toBe(0); // unpublished drafts are deleted
  });

  it('admin can purge a conversation on request', async () => {
    const ctx = makeCtx();
    await discoverAndAnalyze(ctx);
    const app = await appFor(ctx);
    const c = new Client(app);
    await c.login('admin@test.local');
    const conv = await db.conversation.findFirstOrThrow();
    expect((await c.req('POST', `/api/conversations/${conv.id}/purge`)).statusCode).toBe(200);
    const detail = (await c.req('GET', `/api/conversations/${conv.id}`)).json();
    expect(detail.title).toBe('[content purged]');
    expect(detail.processingStatus).toBe('PURGED');
    expect((await c.req('POST', `/api/conversations/${conv.id}/generate-draft`)).statusCode).toBe(409);
    await app.close();
  });
});

import { randomUUID } from 'node:crypto';
import type { PolicyEvaluation, PublishResponse } from '@careerconnect/shared';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import { Prisma } from '../lib/db.ts';
import { AppError, ProviderError, notFound } from '../lib/errors.ts';
import { resolveTarget, type PublishTrigger } from '../policy/engine.ts';
import type { RedditProvider } from '../reddit/types.ts';
import { composePublishBody, evaluateDraftPolicy } from './policy-context.ts';
import { getBrandProfile, getSystemState } from './state.ts';

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Statuses from which a draft may be (re)queued. QUEUED and PUBLISHED are terminal for this purpose. */
const QUEUEABLE = ['NOT_PUBLISHED', 'FAILED', 'BLOCKED'] as const;

export interface PublishRequest {
  draftId: string;
  actorId: string | null;
  trigger: PublishTrigger;
  idempotencyKey?: string;
}

/**
 * Evaluate policy and, only if ELIGIBLE, create a PENDING attempt and queue it.
 * Every request — allowed or not — leaves a PublishAttempt and an AuditEvent.
 */
export async function requestPublish(ctx: AppContext, req: PublishRequest): Promise<PublishResponse> {
  const idempotencyKey = req.idempotencyKey ?? `auto:${req.draftId}:${randomUUID()}`;

  // Idempotent replay: same key returns the original outcome without side effects.
  const existing = await ctx.db.publishAttempt.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.replyDraftId !== req.draftId) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used for a different draft.');
    return {
      queued: existing.status === 'PENDING' || existing.status === 'FAILED_TRANSIENT',
      policy: existing.policyEvaluation as unknown as PolicyEvaluation,
      message: `Duplicate request: attempt ${existing.id} is ${existing.status}.`,
    };
  }

  const draft = await ctx.db.replyDraft.findUnique({ where: { id: req.draftId }, include: { conversation: { select: { dataSource: true } } } });
  if (!draft) throw notFound('Draft');
  const simulated = resolveTarget(ctx.cfg.APP_MODE, draft.conversation.dataSource) === 'simulation';

  const policy = await evaluateDraftPolicy(ctx, req.draftId, { trigger: req.trigger });
  const eligible = policy.decision === 'ELIGIBLE_FOR_AUTOMATION';

  if (!eligible) {
    await ctx.db.$transaction(async (tx) => {
      await tx.publishAttempt.create({
        data: {
          replyDraftId: draft.id,
          idempotencyKey,
          authorizationDecision: policy.decision,
          policyEvaluation: json(policy),
          status: 'BLOCKED',
          errorCategory: 'POLICY',
          errorMessage: policy.reasons.slice(0, 5).join(' | ').slice(0, 1000),
          requestedById: req.actorId,
          completedAt: ctx.now(),
        },
      });
      await tx.replyDraft.update({
        where: { id: draft.id },
        data: {
          policyDecision: policy.decision,
          policyEvaluation: json(policy),
          ...(draft.publishStatus === 'PUBLISHED' || draft.publishStatus === 'QUEUED' ? {} : { publishStatus: 'BLOCKED' }),
        },
      });
      await audit(tx, {
        actorId: req.actorId,
        action: 'publish.blocked',
        entityType: 'ReplyDraft',
        entityId: draft.id,
        reason: policy.reasons[0] ?? null,
        policyVersion: policy.policyVersion,
        metadata: { trigger: req.trigger, decision: policy.decision, failedChecks: policy.checks.filter((c) => c.outcome !== 'PASS').map((c) => c.id) },
      });
    });
    return { queued: false, policy, message: `Publication not permitted (${policy.decision}).` };
  }

  // Atomically claim the draft: only one in-flight publication per draft, ever.
  const attempt = await ctx.db.$transaction(async (tx) => {
    const claimed = await tx.replyDraft.updateMany({
      where: { id: draft.id, publishStatus: { in: [...QUEUEABLE] } },
      data: { publishStatus: 'QUEUED', policyDecision: policy.decision, policyEvaluation: json(policy) },
    });
    if (claimed.count === 0) throw new AppError(409, 'ALREADY_QUEUED_OR_PUBLISHED', 'Draft is already queued or published.');
    const a = await tx.publishAttempt.create({
      data: {
        replyDraftId: draft.id,
        idempotencyKey,
        authorizationDecision: policy.decision,
        policyEvaluation: json(policy),
        status: 'PENDING',
        simulated,
        requestedById: req.actorId,
      },
    });
    await audit(tx, {
      actorId: req.actorId,
      action: 'publish.queued',
      entityType: 'ReplyDraft',
      entityId: draft.id,
      policyVersion: policy.policyVersion,
      metadata: { attemptId: a.id, trigger: req.trigger, simulated: a.simulated },
    });
    return a;
  });

  await ctx.queues.enqueuePublish(attempt.id);
  return {
    queued: true,
    policy,
    message: attempt.simulated ? 'Queued for simulated publication (DEMO mode, nothing is sent to Reddit).' : 'Queued for publication.',
  };
}

export type PublishJobOutcome =
  | { kind: 'succeeded'; commentId: string; simulated: boolean }
  | { kind: 'blocked'; reasons: string[] }
  | { kind: 'skipped'; reason: string }
  | { kind: 'retry'; error: ProviderError }
  | { kind: 'failed'; error: ProviderError };

/**
 * Worker-side execution of one attempt. Re-checks everything; safe to run more than once.
 * The caller (BullMQ processor) turns `retry` into a delayed retry and `failed` into an unrecoverable failure.
 */
export async function processPublishAttempt(ctx: AppContext, attemptId: string, opts: { finalAttempt: boolean }): Promise<PublishJobOutcome> {
  const attempt = await ctx.db.publishAttempt.findUnique({
    where: { id: attemptId },
    include: { replyDraft: { include: { conversation: true } } },
  });
  if (!attempt) return { kind: 'skipped', reason: 'Attempt not found.' };
  if (attempt.status !== 'PENDING' && attempt.status !== 'FAILED_TRANSIENT') {
    return { kind: 'skipped', reason: `Attempt already ${attempt.status}.` };
  }
  const draft = attempt.replyDraft;
  const conv = draft.conversation;
  const trigger: PublishTrigger = attempt.requestedById ? 'human_approved' : 'automation';
  const target = resolveTarget(ctx.cfg.APP_MODE, conv.dataSource);
  const provider: RedditProvider | null = target === 'simulation' ? ctx.simulationPublisher : target === 'reddit' ? ctx.livePublisher : null;

  // Upstream availability (deleted/removed/locked posts must not be answered).
  let unavailableUpstream: boolean | null = null;
  if (provider) {
    try {
      const status = await provider.getPostStatus(conv.externalPostId);
      unavailableUpstream = !status.available;
    } catch (err) {
      if (err instanceof ProviderError && err.retryable && !opts.finalAttempt) return markTransient(ctx, attempt.id, err);
      unavailableUpstream = null; // Unknown availability blocks publication below (fail closed).
    }
  }

  // Full re-evaluation at execution time: kill switch, authorization, community, rate limits, duplicates.
  const policy = await evaluateDraftPolicy(ctx, draft.id, { trigger, unavailableUpstream });
  if (policy.decision !== 'ELIGIBLE_FOR_AUTOMATION' || !provider || unavailableUpstream === null) {
    const reasons = !provider
      ? ['No publisher is available for this mode/data source.']
      : unavailableUpstream === null
        ? ['Could not verify that the post is still available.']
        : policy.reasons;
    await ctx.db.$transaction(async (tx) => {
      await tx.publishAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'BLOCKED',
          errorCategory: 'POLICY',
          errorMessage: reasons.slice(0, 5).join(' | ').slice(0, 1000),
          policyEvaluation: json(policy),
          authorizationDecision: policy.decision,
          completedAt: ctx.now(),
        },
      });
      await tx.replyDraft.update({ where: { id: draft.id }, data: { publishStatus: 'BLOCKED', policyDecision: policy.decision, policyEvaluation: json(policy) } });
      if (unavailableUpstream) {
        await tx.conversation.update({ where: { id: conv.id }, data: { processingStatus: 'SKIPPED', eligibilityStatus: 'SKIP' } });
      }
      await audit(tx, {
        actorId: null,
        action: 'publish.blocked_at_execution',
        entityType: 'PublishAttempt',
        entityId: attempt.id,
        reason: reasons[0] ?? null,
        policyVersion: policy.policyVersion,
      });
    });
    return { kind: 'blocked', reasons };
  }

  const brand = await getBrandProfile(ctx.db);
  const promotional = ((draft.detectorFindings as { detector: string }[] | null) ?? []).some((f) => f.detector === 'promotion' || f.detector === 'url');
  const text = composePublishBody(draft.body, ctx.cfg.BOT_DISCLOSURE_TEXT, promotional && brand.disclosureText ? brand.disclosureText : null);

  try {
    // Duplicate-submission guard: if a previous try may have reached Reddit, look before posting again.
    const existingComment = attempt.retryCount > 0 ? await provider.findOwnComment(conv.externalPostId) : null;
    const commentId = existingComment ?? (await provider.submitComment(conv.externalPostId, text)).commentId;
    const simulated = target === 'simulation';
    await ctx.db.$transaction(async (tx) => {
      await tx.publishAttempt.update({
        where: { id: attempt.id },
        data: { status: simulated ? 'SIMULATED' : 'SUCCEEDED', externalCommentId: commentId, completedAt: ctx.now(), errorCategory: null, errorMessage: null },
      });
      await tx.replyDraft.update({ where: { id: draft.id }, data: { publishStatus: 'PUBLISHED' } });
      await tx.conversation.update({ where: { id: conv.id }, data: { processingStatus: 'PUBLISHED' } });
      await tx.systemState.update({ where: { id: 'system' }, data: { consecutivePublishErrors: 0 } });
      await audit(tx, {
        actorId: attempt.requestedById,
        action: simulated ? 'publish.simulated' : 'publish.succeeded',
        entityType: 'PublishAttempt',
        entityId: attempt.id,
        policyVersion: policy.policyVersion,
        metadata: { commentId, recoveredExisting: Boolean(existingComment) },
      });
    });
    return { kind: 'succeeded', commentId, simulated };
  } catch (err) {
    const perr = err instanceof ProviderError ? err : new ProviderError('UNKNOWN', (err as Error)?.message ?? 'Unknown error', false);
    if (perr.retryable && !opts.finalAttempt) return markTransient(ctx, attempt.id, perr);
    await ctx.db.$transaction(async (tx) => {
      await tx.publishAttempt.update({
        where: { id: attempt.id },
        data: { status: 'FAILED_PERMANENT', errorCategory: perr.category, errorMessage: perr.message.slice(0, 1000), completedAt: ctx.now() },
      });
      await tx.replyDraft.update({ where: { id: draft.id }, data: { publishStatus: 'FAILED' } });
      await audit(tx, { actorId: null, action: 'publish.failed', entityType: 'PublishAttempt', entityId: attempt.id, reason: perr.message.slice(0, 500), metadata: { category: perr.category } });
    });
    await recordPublishError(ctx, perr);
    return { kind: 'failed', error: perr };
  }
}

async function markTransient(ctx: AppContext, attemptId: string, err: ProviderError): Promise<PublishJobOutcome> {
  await ctx.db.publishAttempt.update({
    where: { id: attemptId },
    data: { status: 'FAILED_TRANSIENT', errorCategory: err.category, errorMessage: err.message.slice(0, 1000), retryCount: { increment: 1 } },
  });
  await recordPublishError(ctx, err);
  return { kind: 'retry', error: err };
}

/**
 * Circuit breaker: repeated errors, or any authorization/permission error, pause publishing globally
 * and drop queued jobs. Resuming requires an admin.
 */
export async function recordPublishError(ctx: AppContext, err: ProviderError): Promise<void> {
  const state = await ctx.db.systemState.update({
    where: { id: 'system' },
    data: { consecutivePublishErrors: { increment: 1 } },
  });
  const authProblem = err.category === 'AUTH' || err.category === 'FORBIDDEN';
  if (!state.globalPause && (authProblem || state.consecutivePublishErrors >= ctx.cfg.PUBLISH_CIRCUIT_BREAKER_THRESHOLD)) {
    const reason = authProblem
      ? `Automatic pause: Reddit returned an authorization/permission error (${err.category}).`
      : `Automatic pause: ${state.consecutivePublishErrors} consecutive publish errors (last: ${err.category}).`;
    await pausePublishing(ctx, { actorId: null, reason });
  }
}

export async function pausePublishing(ctx: AppContext, args: { actorId: string | null; reason: string }) {
  await getSystemState(ctx.db);
  await ctx.db.systemState.update({
    where: { id: 'system' },
    data: { globalPause: true, pauseReason: args.reason, pausedAt: ctx.now(), pausedById: args.actorId },
  });
  const removed = await ctx.queues.removePendingPublishJobs();
  // Attempts whose jobs were removed are marked BLOCKED so nothing is left dangling.
  const pending = await ctx.db.publishAttempt.findMany({ where: { status: { in: ['PENDING', 'FAILED_TRANSIENT'] } }, select: { id: true, replyDraftId: true } });
  if (pending.length) {
    await ctx.db.publishAttempt.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: 'BLOCKED', errorCategory: 'POLICY', errorMessage: 'Cancelled by global pause.', completedAt: ctx.now() },
    });
    await ctx.db.replyDraft.updateMany({
      where: { id: { in: pending.map((p) => p.replyDraftId) }, publishStatus: 'QUEUED' },
      data: { publishStatus: 'BLOCKED' },
    });
  }
  await audit(ctx.db, {
    actorId: args.actorId,
    action: 'publishing.paused',
    entityType: 'SystemState',
    entityId: 'system',
    reason: args.reason,
    metadata: { removedJobs: removed, cancelledAttempts: pending.length },
  });
  return { removed, cancelled: pending.length };
}

/** Clears the pause flag only. It does not and cannot grant any missing authorization. */
export async function resumePublishing(ctx: AppContext, args: { actorId: string; reason: string }) {
  await getSystemState(ctx.db);
  await ctx.db.systemState.update({
    where: { id: 'system' },
    data: { globalPause: false, pauseReason: null, pausedAt: null, pausedById: null, consecutivePublishErrors: 0 },
  });
  await audit(ctx.db, { actorId: args.actorId, action: 'publishing.resumed', entityType: 'SystemState', entityId: 'system', reason: args.reason });
}

import { describe, expect, it } from 'vitest';
import type { AuthorizationStatus, DetectorFinding } from '@careerconnect/shared';
import { communityAutomationBlockers, evaluatePolicy, type PolicyInput } from '../../src/policy/engine.ts';

const NOW = new Date('2026-10-31T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** A fully-authorized LIVE input that should be ELIGIBLE. Each test breaks exactly one thing. */
function base(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    now: NOW,
    trigger: 'automation',
    mode: 'LIVE',
    hardDisabled: false,
    globalPause: false,
    redditCredentialsConfigured: true,
    platform: { apiAccessAuthorized: 'APPROVED', commercialUseApproved: 'APPROVED', accountRegisteredAndLabeled: 'APPROVED' },
    community: {
      communityName: 'careeradvice',
      authorizationStatus: 'APPROVED',
      automationAllowed: true,
      promotionAllowed: false,
      ruleSummary: 'Labeled bots allowed; no promotion.',
      lastReviewedAt: daysAgo(3),
      policyVersion: 4,
    },
    policyMaxAgeDays: 30,
    brandPromotionCommunities: [],
    conversation: {
      dataSource: 'REDDIT',
      relevanceScore: 0.9,
      eligibleForResponse: true,
      needsSensitiveHandling: false,
      promptInjectionSuspected: false,
      purged: false,
      unavailableUpstream: false,
    },
    minRelevance: 0.6,
    draft: {
      reviewStatus: 'PENDING_REVIEW',
      publishStatus: 'NOT_PUBLISHED',
      qualityScore: 0.85,
      qualityPassed: true,
      findings: [],
      aiRecommendation: 'REPLY',
    },
    disclosureConfigured: true,
    alreadyPublished: false,
    rateLimits: { configured: true, withinLimits: true, detail: 'ok' },
    ...overrides,
  };
}

const failed = (input: PolicyInput) =>
  evaluatePolicy(input).checks.filter((c) => c.outcome !== 'PASS').map((c) => c.id);

describe('policy engine', () => {
  it('is ELIGIBLE only when every check passes', () => {
    const r = evaluatePolicy(base());
    expect(r.decision).toBe('ELIGIBLE_FOR_AUTOMATION');
    expect(r.checks.every((c) => c.outcome === 'PASS')).toBe(true);
    expect(r.policyVersion).toBe('engine-1/community-careeradvice@v4');
  });

  it.each<[string, AuthorizationStatus]>([
    ['UNKNOWN', 'UNKNOWN'],
    ['PENDING', 'PENDING'],
    ['DENIED', 'DENIED'],
  ])('holds when commercial use is %s', (_l, status) => {
    const input = base({ platform: { ...base().platform!, commercialUseApproved: status } });
    expect(evaluatePolicy(input).decision).toBe('HOLD_FOR_REVIEW');
    expect(failed(input)).toEqual(['commercial_use_approved']);
  });

  it('holds when API access or account labeling is not approved, or platform record is missing', () => {
    expect(failed(base({ platform: { ...base().platform!, apiAccessAuthorized: 'UNKNOWN' } }))).toContain('api_access_authorized');
    expect(failed(base({ platform: { ...base().platform!, accountRegisteredAndLabeled: 'DENIED' } }))).toContain('account_labeled');
    expect(failed(base({ platform: null }))).toEqual(
      expect.arrayContaining(['api_access_authorized', 'commercial_use_approved', 'account_labeled']),
    );
  });

  it('holds when Reddit credentials are missing', () => {
    expect(failed(base({ redditCredentialsConfigured: false }))).toEqual(['reddit_credentials']);
  });

  it('fails closed for communities without a policy record', () => {
    const r = evaluatePolicy(base({ community: null }));
    expect(r.decision).toBe('HOLD_FOR_REVIEW');
    expect(r.checks.find((c) => c.id === 'community_allowlisted')?.outcome).toBe('UNKNOWN');
  });

  it('holds for unapproved communities', () => {
    for (const s of ['UNKNOWN', 'PENDING', 'DENIED'] as const) {
      expect(failed(base({ community: { ...base().community!, authorizationStatus: s } }))).toContain('community_allowlisted');
    }
  });

  it('holds when community rules are stale, never reviewed, or empty', () => {
    expect(failed(base({ community: { ...base().community!, lastReviewedAt: daysAgo(31) } }))).toEqual(['community_rules_current']);
    expect(failed(base({ community: { ...base().community!, lastReviewedAt: null } }))).toEqual(['community_rules_current']);
    expect(failed(base({ community: { ...base().community!, ruleSummary: '   ' } }))).toEqual(['community_rules_current']);
    // A review date in the future is treated as invalid.
    expect(failed(base({ community: { ...base().community!, lastReviewedAt: daysAgo(-5) } }))).toEqual(['community_rules_current']);
  });

  it('holds when the community does not permit automated comments, even for human-approved drafts', () => {
    const community = { ...base().community!, automationAllowed: false };
    expect(failed(base({ community }))).toEqual(['automation_permitted']);
    expect(failed(base({ community, trigger: 'human_approved', draft: { ...base().draft, reviewStatus: 'APPROVED' } }))).toEqual([
      'automation_permitted',
    ]);
  });

  it('skips irrelevant conversations', () => {
    expect(evaluatePolicy(base({ conversation: { ...base().conversation, relevanceScore: 0.2 } })).decision).toBe('SKIP');
    expect(evaluatePolicy(base({ conversation: { ...base().conversation, eligibleForResponse: false } })).decision).toBe('SKIP');
  });

  it('holds unanalyzed conversations (unknown relevance)', () => {
    const r = evaluatePolicy(base({ conversation: { ...base().conversation, relevanceScore: null, eligibleForResponse: null } }));
    expect(r.decision).toBe('HOLD_FOR_REVIEW');
  });

  describe('promotion', () => {
    const promo: DetectorFinding = { detector: 'promotion', severity: 'review', message: 'mentions brand' };

    it('blocks promotion in communities where it is not permitted', () => {
      const input = base({ draft: { ...base().draft, findings: [promo] } });
      expect(failed(input)).toEqual(['no_unsolicited_promotion']);
    });

    it('never auto-publishes promotion, even where it is permitted', () => {
      const input = base({
        community: { ...base().community!, promotionAllowed: true },
        brandPromotionCommunities: ['careeradvice'],
        draft: { ...base().draft, findings: [promo] },
      });
      expect(evaluatePolicy(input).decision).toBe('HOLD_FOR_REVIEW');
    });

    it('allows reviewed promotion only where both the community and brand settings permit it', () => {
      const approved = { ...base().draft, findings: [promo], reviewStatus: 'APPROVED' as const };
      const ok = base({
        trigger: 'human_approved',
        community: { ...base().community!, promotionAllowed: true },
        brandPromotionCommunities: ['CareerAdvice'],
        draft: approved,
      });
      expect(evaluatePolicy(ok).decision).toBe('ELIGIBLE_FOR_AUTOMATION');
      // Brand list missing the community -> still blocked.
      expect(failed({ ...ok, brandPromotionCommunities: [] })).toEqual(['no_unsolicited_promotion']);
    });

    it('blocks unverified brand claims regardless of approval', () => {
      const input = base({
        trigger: 'human_approved',
        community: { ...base().community!, promotionAllowed: true },
        brandPromotionCommunities: ['careeradvice'],
        draft: {
          ...base().draft,
          reviewStatus: 'APPROVED',
          findings: [{ detector: 'unverified_brand_claim', severity: 'block', message: 'x' }],
        },
      });
      expect(failed(input)).toEqual(['no_unsolicited_promotion']);
    });
  });

  it('blocks personal data', () => {
    expect(failed(base({ draft: { ...base().draft, findings: [{ detector: 'pii', severity: 'block', message: 'email' }] } }))).toEqual([
      'privacy',
    ]);
  });

  it('holds sensitive topics for automation but allows human-approved replies', () => {
    const conv = { ...base().conversation, needsSensitiveHandling: true };
    expect(failed(base({ conversation: conv }))).toEqual(['privacy']);
    expect(evaluatePolicy(base({ conversation: conv, trigger: 'human_approved', draft: { ...base().draft, reviewStatus: 'APPROVED' } })).decision).toBe(
      'ELIGIBLE_FOR_AUTOMATION',
    );
  });

  it('skips exact/near duplicates and holds similar replies', () => {
    expect(evaluatePolicy(base({ draft: { ...base().draft, findings: [{ detector: 'duplicate', severity: 'block', message: 'd' }] } })).decision).toBe('SKIP');
    expect(evaluatePolicy(base({ draft: { ...base().draft, findings: [{ detector: 'duplicate', severity: 'review', message: 'd' }] } })).decision).toBe(
      'HOLD_FOR_REVIEW',
    );
  });

  it('fails closed when rate limits are not configured, and holds when exceeded', () => {
    expect(evaluatePolicy(base({ rateLimits: { configured: false, withinLimits: null, detail: '' } })).checks.find((c) => c.id === 'rate_limits')?.outcome).toBe(
      'UNKNOWN',
    );
    expect(failed(base({ rateLimits: { configured: true, withinLimits: false, detail: 'over' } }))).toEqual(['rate_limits']);
  });

  it('honors the kill switch and the hard-disable flag', () => {
    expect(failed(base({ globalPause: true }))).toEqual(['kill_switch']);
    expect(failed(base({ hardDisabled: true }))).toEqual(['kill_switch']);
  });

  it('skips already-published, purged, removed, rejected and skipped items', () => {
    expect(evaluatePolicy(base({ alreadyPublished: true })).decision).toBe('SKIP');
    expect(evaluatePolicy(base({ draft: { ...base().draft, publishStatus: 'PUBLISHED' } })).decision).toBe('SKIP');
    expect(evaluatePolicy(base({ conversation: { ...base().conversation, purged: true } })).decision).toBe('SKIP');
    expect(evaluatePolicy(base({ conversation: { ...base().conversation, unavailableUpstream: true } })).decision).toBe('SKIP');
    expect(evaluatePolicy(base({ draft: { ...base().draft, reviewStatus: 'REJECTED' } })).decision).toBe('SKIP');
    expect(evaluatePolicy(base({ draft: { ...base().draft, reviewStatus: 'SKIPPED' } })).decision).toBe('SKIP');
  });

  it('blocks fabricated personal anecdotes and claims of being human even when approved', () => {
    for (const detector of ['personal_anecdote', 'claims_human', 'prohibited_claim'] as const) {
      const input = base({
        trigger: 'human_approved',
        draft: { ...base().draft, reviewStatus: 'APPROVED', findings: [{ detector, severity: 'block', message: detector }] },
      });
      expect(failed(input)).toEqual(['content_integrity']);
    }
  });

  it('requires the disclosure footer to be configured', () => {
    expect(failed(base({ disclosureConfigured: false }))).toEqual(['disclosure']);
  });

  it('holds when source content contains prompt-injection attempts', () => {
    expect(failed(base({ conversation: { ...base().conversation, promptInjectionSuspected: true } }))).toEqual(['untrusted_input']);
  });

  it('quality scores can hold but never authorize', () => {
    expect(failed(base({ draft: { ...base().draft, qualityPassed: false, qualityScore: 0.3 } }))).toEqual(['quality']);
    // Perfect quality cannot compensate for missing authorization.
    const r = evaluatePolicy(base({ draft: { ...base().draft, qualityScore: 1 }, platform: { ...base().platform!, commercialUseApproved: 'UNKNOWN' } }));
    expect(r.decision).not.toBe('ELIGIBLE_FOR_AUTOMATION');
  });

  it('AI recommendations can only tighten the decision', () => {
    expect(evaluatePolicy(base({ draft: { ...base().draft, aiRecommendation: 'HOLD_FOR_REVIEW' } })).decision).toBe('HOLD_FOR_REVIEW');
    expect(evaluatePolicy(base({ draft: { ...base().draft, aiRecommendation: 'SKIP' } })).decision).toBe('SKIP');
    expect(evaluatePolicy(base({ draft: { ...base().draft, aiRecommendation: null } })).decision).toBe('HOLD_FOR_REVIEW');
    // REPLY cannot rescue an unauthorized community.
    expect(evaluatePolicy(base({ community: { ...base().community!, authorizationStatus: 'DENIED' } })).decision).toBe('HOLD_FOR_REVIEW');
  });

  it('requires reviewer approval for human-triggered publication', () => {
    expect(failed(base({ trigger: 'human_approved' }))).toEqual(['human_review']);
  });

  describe('modes and data sources', () => {
    it('never publishes in DRAFT_ONLY', () => {
      expect(failed(base({ mode: 'DRAFT_ONLY' }))).toContain('mode_target');
    });
    it('never sends synthetic data to Reddit, and never publishes Reddit data outside LIVE', () => {
      expect(failed(base({ conversation: { ...base().conversation, dataSource: 'SYNTHETIC' } }))).toContain('mode_target');
      expect(failed(base({ mode: 'DEMO' }))).toContain('mode_target');
    });
    it('allows simulated publication of synthetic data in DEMO without platform authorization', () => {
      const r = evaluatePolicy(base({ mode: 'DEMO', platform: null, redditCredentialsConfigured: false, conversation: { ...base().conversation, dataSource: 'SYNTHETIC' } }));
      expect(r.decision).toBe('ELIGIBLE_FOR_AUTOMATION');
      expect(r.checks.find((c) => c.id === 'api_access_authorized')?.detail).toMatch(/simulated/);
    });
    it('still applies the kill switch and community policy to simulations', () => {
      const demo = { mode: 'DEMO' as const, conversation: { ...base().conversation, dataSource: 'SYNTHETIC' as const } };
      expect(failed(base({ ...demo, globalPause: true }))).toEqual(['kill_switch']);
      expect(failed(base({ ...demo, community: null }))).toContain('community_allowlisted');
    });
  });

  it('invariant: randomized inputs are ELIGIBLE only if every check passes and all hard requirements hold', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const statuses = ['UNKNOWN', 'PENDING', 'APPROVED', 'DENIED'] as const;
    for (let i = 0; i < 3000; i++) {
      const input = base({
        trigger: pick(['automation', 'human_approved'] as const),
        mode: pick(['DEMO', 'DRAFT_ONLY', 'LIVE'] as const),
        hardDisabled: rnd() < 0.1,
        globalPause: rnd() < 0.2,
        redditCredentialsConfigured: rnd() < 0.8,
        platform: rnd() < 0.1 ? null : { apiAccessAuthorized: pick(statuses), commercialUseApproved: pick(statuses), accountRegisteredAndLabeled: pick(statuses) },
        community: rnd() < 0.1 ? null : { ...base().community!, authorizationStatus: pick(statuses), automationAllowed: rnd() < 0.7, lastReviewedAt: rnd() < 0.2 ? null : daysAgo(rnd() * 60) },
        conversation: { ...base().conversation, dataSource: pick(['SYNTHETIC', 'REDDIT'] as const), relevanceScore: rnd() },
        draft: {
          ...base().draft,
          reviewStatus: pick(['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SKIPPED'] as const),
          findings: rnd() < 0.3 ? [{ detector: pick(['promotion', 'pii', 'duplicate', 'personal_anecdote'] as const), severity: pick(['block', 'review'] as const), message: 'x' }] : [],
          aiRecommendation: pick(['REPLY', 'HOLD_FOR_REVIEW', 'SKIP', null] as const),
        },
        rateLimits: { configured: rnd() < 0.8, withinLimits: rnd() < 0.8, detail: '' },
      });
      const r = evaluatePolicy(input);
      if (r.decision === 'ELIGIBLE_FOR_AUTOMATION') {
        expect(r.checks.every((c) => c.outcome === 'PASS')).toBe(true);
        expect(input.globalPause || input.hardDisabled).toBe(false);
        expect(input.mode).not.toBe('DRAFT_ONLY');
        expect(input.community?.authorizationStatus).toBe('APPROVED');
        expect(input.community?.automationAllowed).toBe(true);
        if (input.conversation.dataSource === 'REDDIT') {
          expect(input.mode).toBe('LIVE');
          expect(input.platform?.commercialUseApproved).toBe('APPROVED');
          expect(input.platform?.apiAccessAuthorized).toBe('APPROVED');
          expect(input.platform?.accountRegisteredAndLabeled).toBe('APPROVED');
          expect(input.rateLimits.configured && input.rateLimits.withinLimits).toBe(true);
        } else {
          expect(input.mode).toBe('DEMO');
        }
      }
    }
  });
});

describe('communityAutomationBlockers', () => {
  it('explains why automation is disabled', () => {
    const blockers = communityAutomationBlockers(
      { communityName: 'x', authorizationStatus: 'UNKNOWN', automationAllowed: false, promotionAllowed: false, ruleSummary: '', lastReviewedAt: null, policyVersion: 1 },
      NOW,
      30,
    );
    expect(blockers).toHaveLength(4);
  });
});

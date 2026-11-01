import type {
  AppMode,
  AuthorizationStatus,
  CheckOutcome,
  DataSource,
  DetectorFinding,
  PolicyCheckResult,
  PolicyDecision,
  PolicyEvaluation,
} from '@careerconnect/shared';

/**
 * Deterministic publication policy engine.
 *
 * This module is intentionally pure: no I/O, no LLM calls, no clock reads except `input.now`.
 * LLM outputs can only make a decision *stricter* (via `aiRecommendation`); they can never
 * satisfy an authorization requirement.
 *
 * Decision rules:
 *  - Any FAIL in a "skip" class check            -> SKIP
 *  - Otherwise any FAIL or UNKNOWN               -> HOLD_FOR_REVIEW
 *  - Every check PASS                            -> ELIGIBLE_FOR_AUTOMATION
 * Unknown / missing data is always UNKNOWN, never PASS (fail closed).
 */
export const POLICY_ENGINE_VERSION = 'engine-1';

export type PublishTrigger = 'automation' | 'human_approved';

/**
 * reddit     – a real submission through the authorized Reddit API.
 * simulation – a mock submission for SYNTHETIC conversations in DEMO mode. Never reaches Reddit.
 */
export type PublishTarget = 'reddit' | 'simulation';

export interface CommunityPolicySnapshot {
  communityName: string;
  authorizationStatus: AuthorizationStatus;
  automationAllowed: boolean;
  promotionAllowed: boolean;
  ruleSummary: string;
  lastReviewedAt: Date | null;
  policyVersion: number;
}

export interface PolicyInput {
  now: Date;
  trigger: PublishTrigger;
  mode: AppMode;
  hardDisabled: boolean;
  globalPause: boolean;
  redditCredentialsConfigured: boolean;
  platform: {
    apiAccessAuthorized: AuthorizationStatus;
    commercialUseApproved: AuthorizationStatus;
    accountRegisteredAndLabeled: AuthorizationStatus;
  } | null;
  community: CommunityPolicySnapshot | null;
  policyMaxAgeDays: number;
  brandPromotionCommunities: string[];
  conversation: {
    dataSource: DataSource;
    relevanceScore: number | null;
    eligibleForResponse: boolean | null;
    needsSensitiveHandling: boolean | null;
    promptInjectionSuspected: boolean | null;
    purged: boolean;
    /** True if the post was deleted/removed/locked upstream (null = unknown/not checked). */
    unavailableUpstream: boolean | null;
  };
  minRelevance: number;
  draft: {
    reviewStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
    publishStatus: 'NOT_PUBLISHED' | 'QUEUED' | 'PUBLISHED' | 'FAILED' | 'BLOCKED';
    qualityScore: number | null;
    qualityPassed: boolean | null;
    findings: DetectorFinding[];
    /** Recommendation from the LLM stages. Can only tighten the decision. */
    aiRecommendation: 'REPLY' | 'HOLD_FOR_REVIEW' | 'SKIP' | null;
  };
  disclosureConfigured: boolean;
  /** Something for this conversation (any draft) was already published. */
  alreadyPublished: boolean;
  rateLimits: {
    configured: boolean;
    withinLimits: boolean | null;
    detail: string;
  };
}

type FailureClass = 'skip' | 'hold';

interface Check extends PolicyCheckResult {
  failureClass: FailureClass;
}

function check(
  id: string,
  label: string,
  outcome: CheckOutcome,
  detail: string,
  failureClass: FailureClass = 'hold',
): Check {
  return { id, label, outcome, detail, failureClass };
}

const statusCheck = (status: AuthorizationStatus | undefined): CheckOutcome =>
  status === 'APPROVED' ? 'PASS' : status === 'DENIED' || status === 'PENDING' ? 'FAIL' : 'UNKNOWN';

export function resolveTarget(mode: AppMode, dataSource: DataSource): PublishTarget | null {
  if (dataSource === 'SYNTHETIC') return mode === 'DEMO' ? 'simulation' : null;
  return mode === 'LIVE' ? 'reddit' : null;
}

export function evaluatePolicy(input: PolicyInput): PolicyEvaluation {
  const checks: Check[] = [];
  const target = resolveTarget(input.mode, input.conversation.dataSource);
  const simulated = target === 'simulation';
  const humanApproved = input.trigger === 'human_approved' && input.draft.reviewStatus === 'APPROVED';
  const findings = input.draft.findings;
  const hasFinding = (d: DetectorFinding['detector'], sev?: DetectorFinding['severity']) =>
    findings.some((f) => f.detector === d && (!sev || f.severity === sev));

  // 0. Data source must match the mode. SYNTHETIC data never reaches Reddit; REDDIT data only in LIVE.
  checks.push(
    target
      ? check('mode_target', 'Mode permits this publication target', 'PASS',
          simulated ? 'DEMO mode: simulated publication to the mock provider only.' : 'LIVE mode with Reddit-sourced conversation.')
      : check('mode_target', 'Mode permits this publication target', 'FAIL',
          input.mode === 'DRAFT_ONLY'
            ? 'DRAFT_ONLY mode never publishes.'
            : `${input.conversation.dataSource} conversations cannot be published in ${input.mode} mode.`),
  );

  // 1–3. Platform authorization (attested by an admin). Not applicable to simulations.
  if (simulated) {
    const na = 'Not applicable: simulated publication never contacts Reddit.';
    checks.push(check('api_access_authorized', 'Reddit API access authorized', 'PASS', na));
    checks.push(check('commercial_use_approved', 'Commercial use approved', 'PASS', na));
    checks.push(check('account_labeled', 'Bot account registered and labeled', 'PASS', na));
  } else {
    const p = input.platform;
    checks.push(check('api_access_authorized', 'Reddit API access authorized',
      statusCheck(p?.apiAccessAuthorized), `Status: ${p?.apiAccessAuthorized ?? 'not recorded'}.`));
    checks.push(check('commercial_use_approved', 'Commercial use approved',
      statusCheck(p?.commercialUseApproved), `Status: ${p?.commercialUseApproved ?? 'not recorded'}. API authentication alone is not commercial approval.`));
    checks.push(check('account_labeled', 'Bot account registered and labeled',
      statusCheck(p?.accountRegisteredAndLabeled), `Status: ${p?.accountRegisteredAndLabeled ?? 'not recorded'}.`));
    checks.push(input.redditCredentialsConfigured
      ? check('reddit_credentials', 'Reddit OAuth credentials configured', 'PASS', 'Credentials present.')
      : check('reddit_credentials', 'Reddit OAuth credentials configured', 'FAIL', 'Reddit credentials are not configured.'));
  }

  // 4–6. Community policy.
  const c = input.community;
  if (!c) {
    checks.push(check('community_allowlisted', 'Community on approved allowlist', 'UNKNOWN', 'No policy record for this community.'));
    checks.push(check('community_rules_current', 'Community rules current and understood', 'UNKNOWN', 'No policy record.'));
    checks.push(check('automation_permitted', 'Automated commenting permitted', 'UNKNOWN', 'No policy record.'));
  } else {
    checks.push(check('community_allowlisted', 'Community on approved allowlist',
      statusCheck(c.authorizationStatus), `r/${c.communityName} authorization: ${c.authorizationStatus}.`));

    const ageDays = c.lastReviewedAt ? (input.now.getTime() - c.lastReviewedAt.getTime()) / 86_400_000 : null;
    if (ageDays === null) {
      checks.push(check('community_rules_current', 'Community rules current and understood', 'UNKNOWN', 'Rules have never been reviewed.'));
    } else if (ageDays > input.policyMaxAgeDays || ageDays < 0) {
      checks.push(check('community_rules_current', 'Community rules current and understood', 'FAIL',
        `Rules last reviewed ${Math.floor(ageDays)} days ago (max ${input.policyMaxAgeDays}).`));
    } else if (!c.ruleSummary.trim()) {
      checks.push(check('community_rules_current', 'Community rules current and understood', 'UNKNOWN', 'Rule summary is empty.'));
    } else {
      checks.push(check('community_rules_current', 'Community rules current and understood', 'PASS',
        `Reviewed ${Math.floor(ageDays)} day(s) ago.`));
    }

    checks.push(c.automationAllowed
      ? check('automation_permitted', 'Automated commenting permitted', 'PASS', 'Community policy permits app-submitted comments.')
      : check('automation_permitted', 'Automated commenting permitted', 'FAIL', 'Community policy does not permit app-submitted comments.'));
  }

  // 7. Relevance.
  const rel = input.conversation.relevanceScore;
  if (input.conversation.eligibleForResponse === false) {
    checks.push(check('relevant', 'Response is relevant to the discussion', 'FAIL', 'Conversation judged not eligible for a response.', 'skip'));
  } else if (rel === null || input.conversation.eligibleForResponse === null) {
    checks.push(check('relevant', 'Response is relevant to the discussion', 'UNKNOWN', 'Conversation has not been analyzed.'));
  } else if (rel < input.minRelevance) {
    checks.push(check('relevant', 'Response is relevant to the discussion', 'FAIL',
      `Relevance ${rel.toFixed(2)} below threshold ${input.minRelevance.toFixed(2)}.`, 'skip'));
  } else {
    checks.push(check('relevant', 'Response is relevant to the discussion', 'PASS', `Relevance ${rel.toFixed(2)}.`));
  }

  // 8. Promotion.
  const promoDetected = hasFinding('promotion') || hasFinding('url') || hasFinding('unverified_brand_claim');
  const promotionAuthorized =
    !!c && c.promotionAllowed &&
    input.brandPromotionCommunities.map((s) => s.toLowerCase()).includes(c.communityName.toLowerCase());
  if (!promoDetected) {
    checks.push(check('no_unsolicited_promotion', 'No unsolicited promotion', 'PASS', 'No promotional content detected.'));
  } else if (hasFinding('unverified_brand_claim', 'block')) {
    checks.push(check('no_unsolicited_promotion', 'No unsolicited promotion', 'FAIL', 'Draft makes brand claims that are not in the verified facts.'));
  } else if (promotionAuthorized && humanApproved) {
    checks.push(check('no_unsolicited_promotion', 'No unsolicited promotion', 'PASS',
      'Promotion is permitted in this community and a reviewer approved this specific reply.'));
  } else {
    checks.push(check('no_unsolicited_promotion', 'No unsolicited promotion', 'FAIL',
      promotionAuthorized
        ? 'Promotional content requires explicit human approval.'
        : 'Promotional content or links are not authorized for this community.'));
  }

  // 9. Privacy and sensitive topics.
  if (hasFinding('pii')) {
    checks.push(check('privacy', 'No privacy or sensitive-topic violations', 'FAIL', 'Draft contains personal data (email, phone, ID numbers…).'));
  } else if (input.conversation.needsSensitiveHandling === null) {
    checks.push(check('privacy', 'No privacy or sensitive-topic violations', 'UNKNOWN', 'Sensitivity not assessed.'));
  } else if (input.conversation.needsSensitiveHandling && !humanApproved) {
    checks.push(check('privacy', 'No privacy or sensitive-topic violations', 'FAIL', 'Sensitive topic: requires human review.'));
  } else {
    checks.push(check('privacy', 'No privacy or sensitive-topic violations', 'PASS',
      input.conversation.needsSensitiveHandling ? 'Sensitive topic reviewed by a human.' : 'No sensitive content detected.'));
  }

  // 10. Duplicates.
  if (hasFinding('duplicate', 'block')) {
    checks.push(check('not_duplicate', 'Not a duplicate or near-duplicate', 'FAIL', 'Draft duplicates an existing reply.', 'skip'));
  } else if (hasFinding('duplicate', 'review') && !humanApproved) {
    checks.push(check('not_duplicate', 'Not a duplicate or near-duplicate', 'FAIL', 'Draft is similar to a previous reply.'));
  } else {
    checks.push(check('not_duplicate', 'Not a duplicate or near-duplicate', 'PASS', 'No near-duplicates found.'));
  }

  // 11. Rate limits (operator-configured from official terms; never invented).
  if (!input.rateLimits.configured) {
    checks.push(check('rate_limits', 'Operational rate limits respected', 'UNKNOWN',
      'Publish limits are not configured. Set them from your approved access terms.'));
  } else if (input.rateLimits.withinLimits === null) {
    checks.push(check('rate_limits', 'Operational rate limits respected', 'UNKNOWN', input.rateLimits.detail));
  } else {
    checks.push(check('rate_limits', 'Operational rate limits respected',
      input.rateLimits.withinLimits ? 'PASS' : 'FAIL', input.rateLimits.detail));
  }

  // 12. Kill switch.
  if (input.hardDisabled) {
    checks.push(check('kill_switch', 'Global kill switch disengaged', 'FAIL', 'PUBLISHING_HARD_DISABLED is set.'));
  } else if (input.globalPause) {
    checks.push(check('kill_switch', 'Global kill switch disengaged', 'FAIL', 'Publishing is globally paused.'));
  } else {
    checks.push(check('kill_switch', 'Global kill switch disengaged', 'PASS', 'Publishing is not paused.'));
  }

  // 13. Already processed / published.
  if (input.alreadyPublished || input.draft.publishStatus === 'PUBLISHED') {
    checks.push(check('not_already_published', 'Not already processed or published', 'FAIL', 'A reply was already published for this conversation.', 'skip'));
  } else if (input.conversation.purged) {
    checks.push(check('not_already_published', 'Not already processed or published', 'FAIL', 'Conversation content was purged.', 'skip'));
  } else if (input.conversation.unavailableUpstream) {
    checks.push(check('not_already_published', 'Not already processed or published', 'FAIL', 'Post was removed, deleted or locked upstream.', 'skip'));
  } else if (input.draft.reviewStatus === 'REJECTED' || input.draft.reviewStatus === 'SKIPPED') {
    checks.push(check('not_already_published', 'Not already processed or published', 'FAIL', `Draft was ${input.draft.reviewStatus.toLowerCase()} by a reviewer.`, 'skip'));
  } else {
    checks.push(check('not_already_published', 'Not already processed or published', 'PASS', 'Not yet published.'));
  }

  // Content integrity: fabricated experience, claims of being human, prohibited claims. Block findings cannot be approved away.
  const blocking = findings.filter((f) =>
    f.severity === 'block' && ['personal_anecdote', 'claims_human', 'prohibited_claim', 'length'].includes(f.detector));
  const reviewable = findings.filter((f) =>
    f.severity === 'review' && ['personal_anecdote', 'claims_human', 'prohibited_claim', 'length'].includes(f.detector));
  if (blocking.length) {
    checks.push(check('content_integrity', 'No fabricated experience or prohibited claims', 'FAIL', blocking.map((f) => f.message).join(' ')));
  } else if (reviewable.length && !humanApproved) {
    checks.push(check('content_integrity', 'No fabricated experience or prohibited claims', 'FAIL', reviewable.map((f) => f.message).join(' ')));
  } else {
    checks.push(check('content_integrity', 'No fabricated experience or prohibited claims', 'PASS', 'No integrity issues detected.'));
  }

  // Quality threshold. A quality score is never permission; it can only hold.
  if (input.draft.qualityPassed === null) {
    checks.push(check('quality', 'Quality threshold met', humanApproved ? 'PASS' : 'UNKNOWN',
      humanApproved ? 'Not evaluated; reviewer approved.' : 'Draft has not been quality-evaluated.'));
  } else if (!input.draft.qualityPassed && !humanApproved) {
    checks.push(check('quality', 'Quality threshold met', 'FAIL',
      `Quality score ${input.draft.qualityScore?.toFixed(2) ?? 'n/a'} below threshold.`));
  } else {
    checks.push(check('quality', 'Quality threshold met', 'PASS',
      input.draft.qualityPassed ? `Quality score ${input.draft.qualityScore?.toFixed(2)}.` : 'Below threshold but approved by a reviewer.'));
  }

  // Prompt-injection attempts in the source post always need a human.
  if (input.conversation.promptInjectionSuspected && !humanApproved) {
    checks.push(check('untrusted_input', 'No manipulation attempts in source content', 'FAIL',
      'Source post appears to contain instructions aimed at the AI.'));
  } else {
    checks.push(check('untrusted_input', 'No manipulation attempts in source content',
      input.conversation.promptInjectionSuspected === null ? 'UNKNOWN' : 'PASS',
      input.conversation.promptInjectionSuspected ? 'Suspected injection reviewed by a human.' : 'None detected.'));
  }

  // Automated-activity disclosure must be configured; the publisher appends it deterministically.
  checks.push(input.disclosureConfigured
    ? check('disclosure', 'Automated-activity disclosure configured', 'PASS', 'Disclosure footer will be appended.')
    : check('disclosure', 'Automated-activity disclosure configured', 'FAIL', 'BOT_DISCLOSURE_TEXT is not configured.'));

  // Human approval: automation may proceed without it; the AI recommendation can only tighten.
  if (input.trigger === 'human_approved' && !humanApproved) {
    checks.push(check('human_review', 'Review state permits publication', 'FAIL', 'Draft has not been approved by a reviewer.'));
  } else if (input.trigger === 'automation' && input.draft.aiRecommendation !== 'REPLY') {
    checks.push(check('human_review', 'Review state permits publication', input.draft.aiRecommendation === null ? 'UNKNOWN' : 'FAIL',
      input.draft.aiRecommendation === null
        ? 'No AI recommendation recorded.'
        : `AI recommended ${input.draft.aiRecommendation}; automation defers to a human.`,
      input.draft.aiRecommendation === 'SKIP' ? 'skip' : 'hold'));
  } else {
    checks.push(check('human_review', 'Review state permits publication', 'PASS',
      humanApproved ? 'Approved by a reviewer.' : 'Automation permitted without human review.'));
  }

  return finalize(checks, input);
}

function finalize(checks: Check[], input: PolicyInput): PolicyEvaluation {
  const failed = checks.filter((c) => c.outcome !== 'PASS');
  let decision: PolicyDecision;
  if (failed.some((c) => c.outcome === 'FAIL' && c.failureClass === 'skip')) decision = 'SKIP';
  else if (failed.length > 0) decision = 'HOLD_FOR_REVIEW';
  else decision = 'ELIGIBLE_FOR_AUTOMATION';

  // Defensive invariant: ELIGIBLE requires every check to PASS.
  if (decision === 'ELIGIBLE_FOR_AUTOMATION' && checks.some((c) => c.outcome !== 'PASS')) {
    decision = 'HOLD_FOR_REVIEW';
  }

  return {
    decision,
    checks: checks.map(({ failureClass: _f, ...rest }) => rest),
    reasons: failed.map((c) => `${c.label}: ${c.detail}`),
    policyVersion: policyVersionString(input.community),
    evaluatedAt: input.now.toISOString(),
  };
}

export function policyVersionString(community: CommunityPolicySnapshot | null): string {
  return `${POLICY_ENGINE_VERSION}/community-${community ? `${community.communityName}@v${community.policyVersion}` : 'none'}`;
}

/** Why automation is currently impossible for a community (for the policies page). */
export function communityAutomationBlockers(c: CommunityPolicySnapshot, now: Date, maxAgeDays: number): string[] {
  const out: string[] = [];
  if (c.authorizationStatus !== 'APPROVED') out.push(`Authorization status is ${c.authorizationStatus}.`);
  if (!c.automationAllowed) out.push('Automated commenting is not permitted by the recorded community policy.');
  if (!c.lastReviewedAt) out.push('Community rules have never been reviewed.');
  else if ((now.getTime() - c.lastReviewedAt.getTime()) / 86_400_000 > maxAgeDays)
    out.push(`Rules review is older than ${maxAgeDays} days.`);
  if (!c.ruleSummary.trim()) out.push('Rule summary is empty.');
  return out;
}

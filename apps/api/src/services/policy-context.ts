import type { ConversationUnderstanding, DetectorFinding, PolicyEvaluation } from '@careerconnect/shared';
import { redditCredentialsPresent } from '../config.ts';
import type { AppContext } from '../context.ts';
import { notFound } from '../lib/errors.ts';
import { evaluatePolicy, resolveTarget, type PolicyInput, type PublishTrigger } from '../policy/engine.ts';
import { getBrandProfile, getDiscoverySettings, getPlatformAuthorization, getSystemState } from './state.ts';

const PUBLISHED_STATUSES = ['SUCCEEDED', 'SIMULATED'] as const;

/** Count real/simulated publications against operator-configured caps. Never invents limits. */
export async function rateLimitState(ctx: AppContext, community: string, simulated: boolean): Promise<PolicyInput['rateLimits']> {
  if (simulated) return { configured: true, withinLimits: true, detail: 'Not applicable: simulated publication.' };
  const { PUBLISH_MAX_PER_HOUR: perHour, PUBLISH_MAX_PER_DAY: perDay, PUBLISH_MAX_PER_COMMUNITY_PER_DAY: perCommunity } = ctx.cfg;
  if (!perHour || !perDay || !perCommunity) {
    return { configured: false, withinLimits: null, detail: 'Publish limits are not configured.' };
  }
  const now = ctx.now().getTime();
  const hourAgo = new Date(now - 3_600_000);
  const dayAgo = new Date(now - 86_400_000);
  const base = { status: 'SUCCEEDED' as const, simulated: false };
  const [hour, day, comm] = await Promise.all([
    ctx.db.publishAttempt.count({ where: { ...base, completedAt: { gte: hourAgo } } }),
    ctx.db.publishAttempt.count({ where: { ...base, completedAt: { gte: dayAgo } } }),
    ctx.db.publishAttempt.count({
      where: { ...base, completedAt: { gte: dayAgo }, replyDraft: { conversation: { communityName: community } } },
    }),
  ]);
  const within = hour < perHour && day < perDay && comm < perCommunity;
  return {
    configured: true,
    withinLimits: within,
    detail: `Last hour ${hour}/${perHour}, last 24h ${day}/${perDay}, r/${community} 24h ${comm}/${perCommunity}.`,
  };
}

export interface PolicyEvalOptions {
  trigger: PublishTrigger;
  /** Result of an upstream availability check, when one was made. */
  unavailableUpstream?: boolean | null;
}

/** Gather everything the pure policy engine needs for one draft, from current DB/config state. */
export async function evaluateDraftPolicy(ctx: AppContext, draftId: string, opts: PolicyEvalOptions): Promise<PolicyEvaluation> {
  const draft = await ctx.db.replyDraft.findUnique({ where: { id: draftId }, include: { conversation: true } });
  if (!draft) throw notFound('Draft');
  const conv = draft.conversation;
  const understanding = conv.understanding as unknown as ConversationUnderstanding | null;
  const [system, platform, brand, settings, community, published] = await Promise.all([
    getSystemState(ctx.db),
    getPlatformAuthorization(ctx.db),
    getBrandProfile(ctx.db),
    getDiscoverySettings(ctx.db),
    ctx.db.subredditPolicy.findUnique({ where: { communityName: conv.communityName.toLowerCase() } }),
    ctx.db.publishAttempt.count({
      where: { status: { in: [...PUBLISHED_STATUSES] }, replyDraft: { conversationId: conv.id } },
    }),
  ]);
  const target = resolveTarget(ctx.cfg.APP_MODE, conv.dataSource);
  const quality = draft.quality as { passed?: boolean; recommendedAction?: 'REPLY' | 'HOLD_FOR_REVIEW' | 'SKIP' } | null;

  return evaluatePolicy({
    now: ctx.now(),
    trigger: opts.trigger,
    mode: ctx.cfg.APP_MODE,
    hardDisabled: ctx.cfg.PUBLISHING_HARD_DISABLED,
    globalPause: system.globalPause,
    redditCredentialsConfigured: redditCredentialsPresent(ctx.cfg),
    platform,
    community,
    policyMaxAgeDays: ctx.cfg.POLICY_MAX_AGE_DAYS,
    brandPromotionCommunities: brand.promotionCommunities,
    conversation: {
      dataSource: conv.dataSource,
      relevanceScore: conv.relevanceScore,
      eligibleForResponse: understanding?.eligibleForResponse ?? null,
      needsSensitiveHandling: understanding?.needsSensitiveHandling ?? null,
      promptInjectionSuspected: understanding?.promptInjectionSuspected ?? null,
      purged: conv.purgedAt !== null,
      unavailableUpstream: opts.unavailableUpstream ?? null,
    },
    minRelevance: settings.minRelevanceForDraft,
    draft: {
      reviewStatus: draft.reviewStatus,
      publishStatus: draft.publishStatus,
      qualityScore: draft.qualityScore,
      qualityPassed: quality?.passed ?? null,
      findings: (draft.detectorFindings as unknown as DetectorFinding[] | null) ?? [],
      aiRecommendation: quality?.recommendedAction ?? null,
    },
    disclosureConfigured: Boolean(ctx.cfg.BOT_DISCLOSURE_TEXT),
    alreadyPublished: published > 0,
    rateLimits: await rateLimitState(ctx, conv.communityName, target === 'simulation'),
  });
}

/** Body exactly as published: reply + automated-activity disclosure (+ brand commercial disclosure when the reply is promotional). */
export function composePublishBody(body: string, botDisclosure: string | undefined, commercialDisclosure: string | null): string {
  const parts = [body.trim()];
  if (commercialDisclosure) parts.push(commercialDisclosure.trim());
  if (botDisclosure) parts.push(`---\n${botDisclosure.trim()}`);
  return parts.join('\n\n');
}

import type {
  BrandProfileDto,
  ConversationContext,
  ConversationSummary,
  ConversationUnderstanding,
  DetectorFinding,
  DraftDetail,
  DraftSummary,
  PlatformAuthorizationDto,
  PolicyEvaluation,
  PublishAttemptSummary,
  QualityAssessment,
  SubredditPolicyDto,
} from '@careerconnect/shared';
import type {
  BrandProfile,
  Conversation,
  PlatformAuthorization,
  PublishAttempt,
  ReplyDraft,
  SubredditPolicy,
} from '../lib/db.ts';
import { communityAutomationBlockers } from '../policy/engine.ts';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function contextOf(c: Conversation): ConversationContext {
  const raw = c.minimalPermittedContext as unknown as ConversationContext | null;
  return raw ?? { title: '[content purged]', excerpt: '', permalink: null, topComments: [] };
}

export function conversationSummary(c: Conversation & { _count?: { drafts: number } }): ConversationSummary {
  const ctx = contextOf(c);
  return {
    id: c.id,
    externalPostId: c.externalPostId,
    communityName: c.communityName,
    dataSource: c.dataSource,
    title: ctx.title,
    excerpt: ctx.excerpt.slice(0, 280),
    topic: c.topic,
    relevanceScore: c.relevanceScore,
    eligibilityStatus: c.eligibilityStatus,
    processingStatus: c.processingStatus,
    discoveredAt: c.discoveredAt.toISOString(),
    processedAt: iso(c.processedAt),
    retentionExpiresAt: c.retentionExpiresAt.toISOString(),
    draftCount: c._count?.drafts ?? 0,
  };
}

export function draftSummary(d: ReplyDraft & { conversation: Conversation }): DraftSummary {
  return {
    id: d.id,
    conversationId: d.conversationId,
    communityName: d.conversation.communityName,
    dataSource: d.conversation.dataSource,
    conversationTitle: contextOf(d.conversation).title,
    body: d.body,
    qualityScore: d.qualityScore,
    reviewStatus: d.reviewStatus,
    publishStatus: d.publishStatus,
    policyDecision: d.policyDecision,
    disclosureStatus: d.disclosureStatus,
    brandRelevance: d.brandRelevance,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function attemptSummary(a: PublishAttempt): PublishAttemptSummary {
  return {
    id: a.id,
    status: a.status,
    authorizationDecision: a.authorizationDecision,
    externalCommentId: a.externalCommentId,
    errorCategory: a.errorCategory,
    errorMessage: a.errorMessage,
    simulated: a.simulated,
    attemptedAt: a.attemptedAt.toISOString(),
    completedAt: iso(a.completedAt),
  };
}

export function draftDetail(
  d: ReplyDraft & { conversation: Conversation; publishAttempts: PublishAttempt[]; reviewedBy: { email: string } | null },
  publishPreview: string | null,
): DraftDetail {
  const ctx = contextOf(d.conversation);
  const quality = d.quality as unknown as (QualityAssessment & { recommendedAction?: string }) | null;
  return {
    ...draftSummary(d),
    originalBody: d.originalBody,
    conversation: {
      id: d.conversation.id,
      title: ctx.title,
      excerpt: ctx.excerpt,
      permalink: ctx.permalink,
      understanding: d.conversation.understanding as unknown as ConversationUnderstanding | null,
    },
    toneAssessment: d.toneAssessment,
    factualityAssessment: d.factualityAssessment,
    promotionalAssessment: d.promotionalAssessment,
    quality: quality
      ? (({ recommendedAction: _r, ...q }) => q)(quality)
      : null,
    detectorFindings: (d.detectorFindings as unknown as DetectorFinding[] | null) ?? [],
    policy: d.policyEvaluation as unknown as PolicyEvaluation | null,
    publishPreview,
    reviewNote: d.reviewNote,
    reviewedBy: d.reviewedBy?.email ?? null,
    reviewedAt: iso(d.reviewedAt),
    publishAttempts: d.publishAttempts
      .sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime())
      .map(attemptSummary),
    model: d.model,
  };
}

export function policyDto(p: SubredditPolicy, now: Date, maxAgeDays: number): SubredditPolicyDto {
  const stale = !p.lastReviewedAt || (now.getTime() - p.lastReviewedAt.getTime()) / 86_400_000 > maxAgeDays;
  return {
    id: p.id,
    communityName: p.communityName,
    ruleSummary: p.ruleSummary,
    knownRestrictions: p.knownRestrictions,
    promotionAllowed: p.promotionAllowed,
    automationAllowed: p.automationAllowed,
    authorizationStatus: p.authorizationStatus,
    discoveryEnabled: p.discoveryEnabled,
    lastReviewedAt: iso(p.lastReviewedAt),
    isStale: stale,
    policyVersion: p.policyVersion,
    automationBlockers: communityAutomationBlockers(p, now, maxAgeDays),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function brandDto(b: BrandProfile): BrandProfileDto {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    audience: b.audience,
    capabilities: b.capabilities,
    verifiedFacts: b.verifiedFacts,
    prohibitedClaims: b.prohibitedClaims,
    approvedUrls: b.approvedUrls,
    disclosureText: b.disclosureText,
    useCases: b.useCases,
    promotionCommunities: b.promotionCommunities,
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function platformDto(p: PlatformAuthorization, reviewedBy: string | null): PlatformAuthorizationDto {
  return {
    apiAccessAuthorized: p.apiAccessAuthorized,
    commercialUseApproved: p.commercialUseApproved,
    accountRegisteredAndLabeled: p.accountRegisteredAndLabeled,
    approvalReference: p.approvalReference,
    botAccountUsername: p.botAccountUsername,
    notes: p.notes,
    reviewedAt: iso(p.reviewedAt),
    reviewedBy,
  };
}

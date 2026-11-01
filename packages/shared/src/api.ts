import { z } from 'zod';
import {
  APP_MODES,
  AUTHORIZATION_STATUSES,
  CAREER_TOPICS,
  ELIGIBILITY_STATUSES,
  PROCESSING_STATUSES,
  REVIEW_STATUSES,
  type AppMode,
  type AuthorizationStatus,
  type CareerTopic,
  type CheckOutcome,
  type DataSource,
  type DisclosureStatus,
  type DraftPublishStatus,
  type EligibilityStatus,
  type ErrorCategory,
  type PolicyDecision,
  type ProcessingStatus,
  type PublishAttemptStatus,
  type ReviewStatus,
  type Role,
} from './enums.js';

// ---------------------------------------------------------------------------
// Conventions
//  - All endpoints live under /api and return JSON.
//  - Errors: { error: { code: string; message: string; details?: unknown } }
//  - Lists:  { items: T[]; total: number; page: number; pageSize: number }
//  - Auth:   httpOnly session cookie `cc_session`. Every mutating request
//            (POST/PATCH/PUT/DELETE) must send header `x-csrf-token` with the
//            value returned by /api/auth/login or /api/auth/me.
//  - Dates are ISO-8601 strings.
// ---------------------------------------------------------------------------

export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_COOKIE = 'cc_session';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ----------------------------------------------------------------- Auth ----

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(512),
});
export type LoginBody = z.infer<typeof loginBody>;

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

/** Returned by POST /api/auth/login and GET /api/auth/me */
export interface SessionResponse {
  user: SessionUser;
  csrfToken: string;
  expiresAt: string;
}

// ------------------------------------------------------------- Policy ----

export interface PolicyCheckResult {
  /** Stable machine id, e.g. "api_access_authorized" */
  id: string;
  label: string;
  outcome: CheckOutcome;
  detail: string;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  checks: PolicyCheckResult[];
  /** Human-readable reasons for any non-PASS outcome. */
  reasons: string[];
  policyVersion: string;
  evaluatedAt: string;
}

// ------------------------------------------------------- Conversations ----

export interface ConversationContext {
  title: string;
  /** Truncated, permitted excerpt of the post body. */
  excerpt: string;
  permalink: string | null;
  /** Small number of truncated top-level comments, when permitted. */
  topComments: string[];
}

export interface ConversationUnderstanding {
  mainQuestion: string;
  userGoal: string;
  relevantContext: string;
  topic: CareerTopic;
  emotionalTone: string;
  canProduceUsefulAnswer: boolean;
  needsSensitiveHandling: boolean;
  eligibleForResponse: boolean;
  reason: string;
  promptInjectionSuspected: boolean;
}

export interface ConversationSummary {
  id: string;
  externalPostId: string;
  communityName: string;
  dataSource: DataSource;
  title: string;
  excerpt: string;
  topic: CareerTopic | null;
  relevanceScore: number | null;
  eligibilityStatus: EligibilityStatus;
  processingStatus: ProcessingStatus;
  discoveredAt: string;
  processedAt: string | null;
  retentionExpiresAt: string;
  draftCount: number;
}

export interface ConversationDetail extends ConversationSummary {
  context: ConversationContext;
  understanding: ConversationUnderstanding | null;
  drafts: DraftSummary[];
}

export const conversationListQuery = paginationQuery.extend({
  community: z.string().trim().max(100).optional(),
  topic: z.enum(CAREER_TOPICS).optional(),
  eligibilityStatus: z.enum(ELIGIBILITY_STATUSES).optional(),
  processingStatus: z.enum(PROCESSING_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuery>;

// ------------------------------------------------------------- Drafts ----

export interface QualityAssessment {
  relevance: number; // 0..1
  factualSupport: number;
  specificity: number;
  clarity: number;
  tone: number;
  repetitionRisk: number; // 0..1, higher = worse
  promotionalContent: boolean;
  privacyRisk: boolean;
  unsupportedPersonalExperience: boolean;
  potentiallyHarmfulAdvice: boolean;
  overallScore: number; // 0..1
  passed: boolean;
  notes: string[];
}

/** Findings from deterministic (non-LLM) detectors. */
export interface DetectorFinding {
  detector:
    | 'promotion'
    | 'url'
    | 'personal_anecdote'
    | 'pii'
    | 'prohibited_claim'
    | 'unverified_brand_claim'
    | 'duplicate'
    | 'claims_human'
    | 'length';
  severity: 'block' | 'review' | 'info';
  message: string;
  excerpt?: string;
}

export interface DraftSummary {
  id: string;
  conversationId: string;
  communityName: string;
  dataSource: DataSource;
  conversationTitle: string;
  body: string;
  qualityScore: number | null;
  reviewStatus: ReviewStatus;
  publishStatus: DraftPublishStatus;
  policyDecision: PolicyDecision | null;
  disclosureStatus: DisclosureStatus;
  brandRelevance: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublishAttemptSummary {
  id: string;
  status: PublishAttemptStatus;
  authorizationDecision: PolicyDecision;
  externalCommentId: string | null;
  errorCategory: ErrorCategory | null;
  errorMessage: string | null;
  simulated: boolean;
  attemptedAt: string;
  completedAt: string | null;
}

export interface DraftDetail extends DraftSummary {
  originalBody: string;
  conversation: {
    id: string;
    title: string;
    excerpt: string;
    permalink: string | null;
    understanding: ConversationUnderstanding | null;
  };
  toneAssessment: string | null;
  factualityAssessment: string | null;
  promotionalAssessment: string | null;
  quality: QualityAssessment | null;
  detectorFindings: DetectorFinding[];
  policy: PolicyEvaluation | null;
  /** Body exactly as it would be published (with disclosure footer). */
  publishPreview: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishAttempts: PublishAttemptSummary[];
  model: string | null;
}

export const draftListQuery = paginationQuery.extend({
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  publishStatus: z.enum(['NOT_PUBLISHED', 'QUEUED', 'PUBLISHED', 'FAILED', 'BLOCKED']).optional(),
});
export type DraftListQuery = z.infer<typeof draftListQuery>;

export const approveDraftBody = z.object({
  /** Optional reviewer edit. Re-runs deterministic detectors and the policy engine. */
  body: z.string().trim().min(1).max(5000).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type ApproveDraftBody = z.infer<typeof approveDraftBody>;

export const rejectDraftBody = z.object({
  reason: z.string().trim().min(1).max(1000),
  /** "skip" marks the conversation as not worth answering; "reject" marks the draft as bad. */
  kind: z.enum(['reject', 'skip']).default('reject'),
});
export type RejectDraftBody = z.infer<typeof rejectDraftBody>;

export interface PublishResponse {
  queued: boolean;
  policy: PolicyEvaluation;
  message: string;
}

// ------------------------------------------------------------ Policies ----

export interface SubredditPolicyDto {
  id: string;
  communityName: string;
  ruleSummary: string;
  knownRestrictions: string[];
  promotionAllowed: boolean;
  automationAllowed: boolean;
  authorizationStatus: AuthorizationStatus;
  discoveryEnabled: boolean;
  lastReviewedAt: string | null;
  isStale: boolean;
  policyVersion: number;
  /** Reasons automated publication is currently not possible in this community. */
  automationBlockers: string[];
  createdAt: string;
  updatedAt: string;
}

export const createPolicyBody = z.object({
  communityName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{2,21}$/, 'Community names are 2–21 letters, digits or underscores (without r/)'),
});

export const updatePolicyBody = z
  .object({
    ruleSummary: z.string().trim().max(5000),
    knownRestrictions: z.array(z.string().trim().min(1).max(300)).max(50),
    promotionAllowed: z.boolean(),
    automationAllowed: z.boolean(),
    authorizationStatus: z.enum(AUTHORIZATION_STATUSES),
    discoveryEnabled: z.boolean(),
    /** Set true to record that a human re-read the community rules now. */
    markReviewed: z.boolean(),
    reason: z.string().trim().min(3).max(1000),
  })
  .partial()
  .required({ reason: true });
export type UpdatePolicyBody = z.infer<typeof updatePolicyBody>;

// ------------------------------------------------------- Brand profile ----

export interface BrandProfileDto {
  id: string;
  name: string;
  description: string;
  audience: string;
  capabilities: string[];
  verifiedFacts: string[];
  prohibitedClaims: string[];
  approvedUrls: string[];
  disclosureText: string;
  useCases: string[];
  promotionCommunities: string[];
  updatedAt: string;
}

export const updateBrandProfileBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000),
    audience: z.string().trim().max(1000),
    capabilities: z.array(z.string().trim().min(1).max(300)).max(50),
    verifiedFacts: z.array(z.string().trim().min(1).max(500)).max(100),
    prohibitedClaims: z.array(z.string().trim().min(1).max(300)).max(100),
    approvedUrls: z.array(z.string().trim().url().max(500)).max(50),
    disclosureText: z.string().trim().max(500),
    useCases: z.array(z.string().trim().min(1).max(300)).max(50),
    promotionCommunities: z.array(z.string().trim().min(2).max(21)).max(50),
    reason: z.string().trim().min(3).max(1000),
  })
  .partial()
  .required({ reason: true });
export type UpdateBrandProfileBody = z.infer<typeof updateBrandProfileBody>;

// ------------------------------------------------------- Platform/admin ----

export interface PlatformAuthorizationDto {
  apiAccessAuthorized: AuthorizationStatus;
  commercialUseApproved: AuthorizationStatus;
  accountRegisteredAndLabeled: AuthorizationStatus;
  approvalReference: string | null;
  botAccountUsername: string | null;
  notes: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export const updatePlatformAuthorizationBody = z
  .object({
    apiAccessAuthorized: z.enum(AUTHORIZATION_STATUSES),
    commercialUseApproved: z.enum(AUTHORIZATION_STATUSES),
    accountRegisteredAndLabeled: z.enum(AUTHORIZATION_STATUSES),
    approvalReference: z.string().trim().max(500).nullable(),
    botAccountUsername: z.string().trim().max(50).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    reason: z.string().trim().min(3).max(1000),
  })
  .partial()
  .required({ reason: true });

export const pauseBody = z.object({ reason: z.string().trim().min(3).max(1000) });

export interface PublishingStateDto {
  mode: AppMode;
  globalPause: boolean;
  pauseReason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  /** True when publishing is impossible for configuration reasons regardless of the pause flag. */
  blockedReasons: string[];
  /** Number of publish jobs removed from the queue by the last pause. */
  removedJobs?: number;
}

// ------------------------------------------------------ Dashboard/metrics ----

export interface DashboardSummary {
  mode: AppMode;
  dataSources: DataSource[];
  conversationsDiscovered: number;
  relevantConversations: number;
  draftsGenerated: number;
  draftsAwaitingReview: number;
  repliesPublished: number;
  simulatedPublications: number;
  qualityRejectionRate: number | null; // 0..1
  negativeFeedback: number;
  policyIncidents: number;
  cost: {
    configured: boolean;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number | null;
    windowDays: number;
  };
  publishing: PublishingStateDto;
}

export interface MetricPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface MetricsResponse {
  windowDays: number;
  series: {
    conversationsDiscovered: MetricPoint[];
    draftsGenerated: MetricPoint[];
    repliesPublished: MetricPoint[];
    qualityRejections: MetricPoint[];
  };
  engagement: {
    /** Recorded CampaignMetric values; empty until real measurements exist. */
    metricName: string;
    total: number;
    attributionMethod: string;
  }[];
  topicBreakdown: { topic: CareerTopic; count: number }[];
  communityBreakdown: { communityName: string; count: number; published: number }[];
}

export const metricsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export interface SystemHealth {
  status: 'ok' | 'degraded';
  mode: AppMode;
  version: string;
  database: { ok: boolean; latencyMs: number | null; error?: string };
  redis: { ok: boolean; latencyMs: number | null; error?: string };
  reddit: {
    configured: boolean;
    mode: 'mock' | 'live' | 'disabled';
    lastCheckOk: boolean | null;
    detail: string;
  };
  llm: { provider: string; configured: boolean; models: Record<string, string> };
  queues: {
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
  }[];
  failedJobs: { queue: string; id: string; name: string; failedReason: string; finishedOn: string | null }[];
  tokenUsage: { last24h: { inputTokens: number; outputTokens: number; calls: number } };
  publishing: PublishingStateDto;
}

export interface AuditEventDto {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  reason: string | null;
  entityType: string;
  entityId: string | null;
  policyVersion: string | null;
  metadata: unknown;
  createdAt: string;
}

export const auditListQuery = paginationQuery.extend({
  entityType: z.string().trim().max(50).optional(),
  action: z.string().trim().max(100).optional(),
});

export interface DiscoveryRunResponse {
  queued: boolean;
  jobId: string | null;
  message: string;
}

export const discoverySettingsBody = z.object({
  keywords: z.array(z.string().trim().min(2).max(60)).max(100),
  exclusions: z.array(z.string().trim().min(2).max(60)).max(100),
  topics: z.array(z.enum(CAREER_TOPICS)).max(CAREER_TOPICS.length),
  maxPostsPerRun: z.number().int().min(1).max(100),
  minRelevanceForDraft: z.number().min(0).max(1),
  reason: z.string().trim().min(3).max(1000),
});
export type DiscoverySettingsBody = z.infer<typeof discoverySettingsBody>;

export interface DiscoverySettingsDto {
  keywords: string[];
  exclusions: string[];
  topics: CareerTopic[];
  maxPostsPerRun: number;
  minRelevanceForDraft: number;
  updatedAt: string;
}

export type { AppMode as Mode };
export const appModeSchema = z.enum(APP_MODES);

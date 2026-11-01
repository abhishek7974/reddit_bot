// Enum values shared by the API, the worker and the dashboard.
// They mirror the Prisma enums in apps/api/prisma/schema.prisma — keep both in sync.

export const ROLES = ['ADMIN', 'REVIEWER', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

/**
 * DEMO       – synthetic fixtures only, no Reddit calls at all.
 * DRAFT_ONLY – may read from Reddit (if authorized) but never publishes.
 * LIVE       – publication possible, but only when every policy check passes.
 */
export const APP_MODES = ['DEMO', 'DRAFT_ONLY', 'LIVE'] as const;
export type AppMode = (typeof APP_MODES)[number];

export const AUTHORIZATION_STATUSES = ['UNKNOWN', 'PENDING', 'APPROVED', 'DENIED'] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

export const POLICY_DECISIONS = ['SKIP', 'HOLD_FOR_REVIEW', 'ELIGIBLE_FOR_AUTOMATION'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const ELIGIBILITY_STATUSES = ['PENDING', ...POLICY_DECISIONS] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const PROCESSING_STATUSES = [
  'DISCOVERED',
  'ANALYZED',
  'DRAFTED',
  'SKIPPED',
  'PUBLISHED',
  'PURGED',
  'FAILED',
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const REVIEW_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SKIPPED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const DRAFT_PUBLISH_STATUSES = ['NOT_PUBLISHED', 'QUEUED', 'PUBLISHED', 'FAILED', 'BLOCKED'] as const;
export type DraftPublishStatus = (typeof DRAFT_PUBLISH_STATUSES)[number];

export const DISCLOSURE_STATUSES = ['INCLUDED', 'MISSING', 'NOT_CONFIGURED'] as const;
export type DisclosureStatus = (typeof DISCLOSURE_STATUSES)[number];

export const PUBLISH_ATTEMPT_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED_TRANSIENT',
  'FAILED_PERMANENT',
  'BLOCKED',
  'SIMULATED',
] as const;
export type PublishAttemptStatus = (typeof PUBLISH_ATTEMPT_STATUSES)[number];

export const ERROR_CATEGORIES = [
  'RATE_LIMITED',
  'NETWORK',
  'AUTH',
  'FORBIDDEN',
  'NOT_FOUND',
  'POLICY',
  'SERVER',
  'VALIDATION',
  'UNKNOWN',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** Where a conversation came from. The UI must label SYNTHETIC data clearly as demo data. */
export const DATA_SOURCES = ['SYNTHETIC', 'REDDIT'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const CAREER_TOPICS = [
  'RESUME_FEEDBACK',
  'JOB_APPLICATIONS',
  'INTERVIEW_PREP',
  'CAREER_TRANSITION',
  'SOFTWARE_CAREERS',
  'ENTRY_LEVEL',
  'SALARY_NEGOTIATION',
  'RECRUITER_COMMUNICATION',
  'PORTFOLIO_FEEDBACK',
  'WORKPLACE_DEVELOPMENT',
  'OTHER',
] as const;
export type CareerTopic = (typeof CAREER_TOPICS)[number];

export const CAREER_TOPIC_LABELS: Record<CareerTopic, string> = {
  RESUME_FEEDBACK: 'Resume feedback',
  JOB_APPLICATIONS: 'Job applications',
  INTERVIEW_PREP: 'Interview preparation',
  CAREER_TRANSITION: 'Career transitions',
  SOFTWARE_CAREERS: 'Software development careers',
  ENTRY_LEVEL: 'Entry-level jobs',
  SALARY_NEGOTIATION: 'Salary negotiation',
  RECRUITER_COMMUNICATION: 'Recruiter communication',
  PORTFOLIO_FEEDBACK: 'Portfolio and project feedback',
  WORKPLACE_DEVELOPMENT: 'Workplace and professional development',
  OTHER: 'Other',
};

export const CHECK_OUTCOMES = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

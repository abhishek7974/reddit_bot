-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AuthorizationStatus" AS ENUM ('UNKNOWN', 'PENDING', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "EligibilityStatus" AS ENUM ('PENDING', 'SKIP', 'HOLD_FOR_REVIEW', 'ELIGIBLE_FOR_AUTOMATION');

-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('SKIP', 'HOLD_FOR_REVIEW', 'ELIGIBLE_FOR_AUTOMATION');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('DISCOVERED', 'ANALYZED', 'DRAFTED', 'SKIPPED', 'PUBLISHED', 'PURGED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DraftPublishStatus" AS ENUM ('NOT_PUBLISHED', 'QUEUED', 'PUBLISHED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DisclosureStatus" AS ENUM ('INCLUDED', 'MISSING', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "PublishAttemptStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED_TRANSIENT', 'FAILED_PERMANENT', 'BLOCKED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('RATE_LIMITED', 'NETWORK', 'AUTH', 'FORBIDDEN', 'NOT_FOUND', 'POLICY', 'SERVER', 'VALIDATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('SYNTHETIC', 'REDDIT');

-- CreateEnum
CREATE TYPE "CareerTopic" AS ENUM ('RESUME_FEEDBACK', 'JOB_APPLICATIONS', 'INTERVIEW_PREP', 'CAREER_TRANSITION', 'SOFTWARE_CAREERS', 'ENTRY_LEVEL', 'SALARY_NEGOTIATION', 'RECRUITER_COMMUNICATION', 'PORTFOLIO_FEEDBACK', 'WORKPLACE_DEVELOPMENT', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "externalAuthId" TEXT,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL DEFAULT '',
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verifiedFacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prohibitedClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvedUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "disclosureText" TEXT NOT NULL DEFAULT '',
    "useCases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promotionCommunities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubredditPolicy" (
    "id" TEXT NOT NULL,
    "communityName" TEXT NOT NULL,
    "ruleSummary" TEXT NOT NULL DEFAULT '',
    "knownRestrictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promotionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "automationAllowed" BOOLEAN NOT NULL DEFAULT false,
    "authorizationStatus" "AuthorizationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "discoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastReviewedAt" TIMESTAMP(3),
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubredditPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuthorization" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "apiAccessAuthorized" "AuthorizationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "commercialUseApproved" "AuthorizationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "accountRegisteredAndLabeled" "AuthorizationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "approvalReference" TEXT,
    "botAccountUsername" TEXT,
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemState" (
    "id" TEXT NOT NULL DEFAULT 'system',
    "globalPause" BOOLEAN NOT NULL DEFAULT true,
    "pauseReason" TEXT DEFAULT 'Publishing is paused until an administrator verifies authorization.',
    "pausedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "pausedById" TEXT,
    "consecutivePublishErrors" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySettings" (
    "id" TEXT NOT NULL DEFAULT 'discovery',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" "CareerTopic"[] DEFAULT ARRAY[]::"CareerTopic"[],
    "maxPostsPerRun" INTEGER NOT NULL DEFAULT 25,
    "minRelevanceForDraft" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "dataSource" "DataSource" NOT NULL,
    "communityName" TEXT NOT NULL,
    "topic" "CareerTopic",
    "relevanceScore" DOUBLE PRECISION,
    "eligibilityStatus" "EligibilityStatus" NOT NULL DEFAULT 'PENDING',
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'DISCOVERED',
    "minimalPermittedContext" JSONB,
    "understanding" JSONB,
    "contentHash" TEXT,
    "postCreatedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyDraft" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "originalBody" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "toneAssessment" TEXT,
    "factualityAssessment" TEXT,
    "promotionalAssessment" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "quality" JSONB,
    "detectorFindings" JSONB,
    "brandRelevance" DOUBLE PRECISION,
    "disclosureStatus" "DisclosureStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "publishStatus" "DraftPublishStatus" NOT NULL DEFAULT 'NOT_PUBLISHED',
    "policyDecision" "PolicyDecision",
    "policyEvaluation" JSONB,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "model" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL,
    "replyDraftId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "authorizationDecision" "PolicyDecision" NOT NULL,
    "policyEvaluation" JSONB,
    "status" "PublishAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "externalCommentId" TEXT,
    "errorCategory" "ErrorCategory",
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "policyVersion" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMetric" (
    "id" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributionMethod" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "CampaignMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalAuthId_key" ON "User"("externalAuthId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubredditPolicy_communityName_key" ON "SubredditPolicy"("communityName");

-- CreateIndex
CREATE INDEX "Conversation_communityName_idx" ON "Conversation"("communityName");

-- CreateIndex
CREATE INDEX "Conversation_eligibilityStatus_idx" ON "Conversation"("eligibilityStatus");

-- CreateIndex
CREATE INDEX "Conversation_processingStatus_idx" ON "Conversation"("processingStatus");

-- CreateIndex
CREATE INDEX "Conversation_retentionExpiresAt_idx" ON "Conversation"("retentionExpiresAt");

-- CreateIndex
CREATE INDEX "Conversation_discoveredAt_idx" ON "Conversation"("discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_dataSource_externalPostId_key" ON "Conversation"("dataSource", "externalPostId");

-- CreateIndex
CREATE INDEX "ReplyDraft_conversationId_idx" ON "ReplyDraft"("conversationId");

-- CreateIndex
CREATE INDEX "ReplyDraft_reviewStatus_idx" ON "ReplyDraft"("reviewStatus");

-- CreateIndex
CREATE INDEX "ReplyDraft_publishStatus_idx" ON "ReplyDraft"("publishStatus");

-- CreateIndex
CREATE INDEX "ReplyDraft_contentHash_idx" ON "ReplyDraft"("contentHash");

-- CreateIndex
CREATE INDEX "ReplyDraft_createdAt_idx" ON "ReplyDraft"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_idempotencyKey_key" ON "PublishAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishAttempt_replyDraftId_idx" ON "PublishAttempt"("replyDraftId");

-- CreateIndex
CREATE INDEX "PublishAttempt_status_idx" ON "PublishAttempt"("status");

-- CreateIndex
CREATE INDEX "PublishAttempt_attemptedAt_idx" ON "PublishAttempt"("attemptedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "CampaignMetric_metricName_measuredAt_idx" ON "CampaignMetric"("metricName", "measuredAt");

-- CreateIndex
CREATE INDEX "LlmUsage_createdAt_idx" ON "LlmUsage"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyDraft" ADD CONSTRAINT "ReplyDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyDraft" ADD CONSTRAINT "ReplyDraft_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_replyDraftId_fkey" FOREIGN KEY ("replyDraftId") REFERENCES "ReplyDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

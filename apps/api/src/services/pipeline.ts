import type {
  ConversationContext,
  ConversationUnderstanding,
  DetectorFinding,
  QualityAssessment,
} from '@careerconnect/shared';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import { AppError, ProviderError, notFound } from '../lib/errors.ts';
import { Prisma } from '../lib/db.ts';
import {
  EVALUATION_SYSTEM,
  GENERATION_SYSTEM,
  PROMPT_VERSION,
  UNDERSTANDING_SYSTEM,
  evaluationUserPrompt,
  generationUserPrompt,
  renderUntrusted,
} from '../llm/prompts.ts';
import type { LlmRequest, LlmResult } from '../llm/provider.ts';
import { evaluationSchema, generationSchema, understandingSchema, type GenerationOutput } from '../llm/schemas.ts';
import { contentHash, detectPromptInjection, runDetectors } from '../policy/detectors.ts';
import { evaluateDraftPolicy } from './policy-context.ts';
import { requestPublish } from './publish.ts';
import { getBrandProfile, getDiscoverySettings } from './state.ts';

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Enforce the optional daily token budget, then call the provider and record usage. */
async function callLlm<T>(ctx: AppContext, req: LlmRequest<T>): Promise<LlmResult<T>> {
  const budget = ctx.cfg.LLM_DAILY_TOKEN_BUDGET;
  if (budget) {
    const since = new Date(ctx.now().getTime() - 86_400_000);
    const used = await ctx.db.llmUsage.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const total = (used._sum.inputTokens ?? 0) + (used._sum.outputTokens ?? 0);
    if (total >= budget) throw new AppError(429, 'LLM_BUDGET_EXCEEDED', `Daily LLM token budget (${budget}) exhausted.`);
  }
  if (!ctx.llm.configured) throw new AppError(503, 'LLM_NOT_CONFIGURED', `LLM provider "${ctx.llm.name}" is not configured.`);
  const res = await ctx.llm.completeJson(req);
  await ctx.db.llmUsage.create({
    data: {
      provider: ctx.llm.name,
      model: res.model,
      stage: req.stage,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
    },
  });
  return res;
}

function contextOf(raw: unknown): ConversationContext | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as ConversationContext;
}

/** Automatic pipeline for a newly discovered conversation: understand, then draft if worthwhile. */
export async function analyzeConversation(ctx: AppContext, conversationId: string): Promise<'drafted' | 'skipped' | 'held'> {
  const conv = await ctx.db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw notFound('Conversation');
  if (conv.purgedAt || !contextOf(conv.minimalPermittedContext)) return 'skipped';
  if (conv.processingStatus !== 'DISCOVERED' && conv.processingStatus !== 'FAILED') return 'skipped';

  const { skip } = await understandConversation(ctx, conv.id);
  if (skip) return 'skipped';
  try {
    const draft = await generateDraft(ctx, conv.id, null);
    return draft.policyDecision === 'ELIGIBLE_FOR_AUTOMATION' ? 'drafted' : 'held';
  } catch (err) {
    if (err instanceof AppError && err.code === 'AI_RECOMMENDED_SKIP') return 'skipped';
    throw err;
  }
}

/** Stage 1: understand the conversation and decide whether it is worth drafting a reply. */
export async function understandConversation(ctx: AppContext, conversationId: string): Promise<{ skip: boolean }> {
  const conv = await ctx.db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw notFound('Conversation');
  const context = contextOf(conv.minimalPermittedContext);
  if (conv.purgedAt || !context) throw new AppError(409, 'PURGED', 'Conversation content has been purged.');

  const settings = await getDiscoverySettings(ctx.db);
  const res = await callLlm(ctx, {
    stage: 'classify',
    system: UNDERSTANDING_SYSTEM,
    user: renderUntrusted(context, conv.communityName),
    schema: understandingSchema,
    schemaName: 'conversation_understanding',
  });
  const u = res.data;
  const injection = u.prompt_injection_suspected || detectPromptInjection(`${context.title}\n${context.excerpt}`);
  const understanding: ConversationUnderstanding = {
    mainQuestion: u.main_question,
    userGoal: u.user_goal,
    relevantContext: u.relevant_context,
    topic: u.topic,
    emotionalTone: u.emotional_tone,
    canProduceUsefulAnswer: u.can_produce_useful_answer,
    needsSensitiveHandling: u.needs_sensitive_handling,
    eligibleForResponse: u.eligible_for_response && u.can_produce_useful_answer,
    reason: u.reason,
    promptInjectionSuspected: injection,
  };
  const relevance = clamp01(u.relevance_score);
  const topicAllowed = settings.topics.length === 0 || settings.topics.includes(u.topic);
  const skip = !understanding.eligibleForResponse || relevance < settings.minRelevanceForDraft || !topicAllowed;

  await ctx.db.conversation.update({
    where: { id: conv.id },
    data: {
      understanding: json(understanding),
      topic: u.topic,
      relevanceScore: relevance,
      processedAt: ctx.now(),
      processingStatus: skip ? 'SKIPPED' : 'ANALYZED',
      eligibilityStatus: skip ? 'SKIP' : 'PENDING',
    },
  });
  return { skip };
}

/** Stages 2+3: generate a reply, evaluate it, run deterministic detectors and the policy engine. */
export async function generateDraft(ctx: AppContext, conversationId: string, actorId: string | null) {
  const conv = await ctx.db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw notFound('Conversation');
  const context = contextOf(conv.minimalPermittedContext);
  if (conv.purgedAt || !context) throw new AppError(409, 'PURGED', 'Conversation content has been purged.');
  const understanding = conv.understanding as unknown as ConversationUnderstanding | null;
  if (!understanding) throw new AppError(409, 'NOT_ANALYZED', 'Conversation has not been analyzed yet.');
  if (conv.processingStatus === 'PUBLISHED') throw new AppError(409, 'ALREADY_PUBLISHED', 'A reply was already published.');

  const [brand, community, recent] = await Promise.all([
    getBrandProfile(ctx.db),
    ctx.db.subredditPolicy.findUnique({ where: { communityName: conv.communityName.toLowerCase() } }),
    ctx.db.replyDraft.findMany({
      where: { reviewStatus: { not: 'REJECTED' }, conversationId: { not: conv.id } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, body: true },
    }),
  ]);
  const promotionPermittedHere =
    !!community?.promotionAllowed &&
    brand.promotionCommunities.map((c) => c.toLowerCase()).includes(conv.communityName.toLowerCase());
  const brandConfigured = brand.name !== 'Unconfigured brand';

  const gen = await callLlm(ctx, {
    stage: 'generate',
    system: GENERATION_SYSTEM,
    user: generationUserPrompt({
      community: conv.communityName,
      ctx: context,
      understanding,
      brand: brandConfigured
        ? {
            name: brand.name,
            description: brand.description,
            verifiedFacts: brand.verifiedFacts,
            prohibitedClaims: brand.prohibitedClaims,
            promotionPermittedHere,
          }
        : null,
      recentReplyOpenings: recent.slice(0, 8).map((r) => r.body.split(/\s+/).slice(0, 8).join(' ')),
    }),
    schema: generationSchema,
    schemaName: 'reply_generation',
  });
  const g: GenerationOutput = gen.data;
  const reply = g.proposed_reply.trim();

  if (g.recommended_action === 'SKIP' || !reply) {
    await ctx.db.conversation.update({
      where: { id: conv.id },
      data: { processingStatus: 'SKIPPED', eligibilityStatus: 'SKIP', processedAt: ctx.now() },
    });
    await audit(ctx.db, {
      actorId,
      action: 'draft.skipped_by_ai',
      entityType: 'Conversation',
      entityId: conv.id,
      reason: g.reason_for_skip_or_review || 'AI recommended not replying.',
    });
    throw new AppError(422, 'AI_RECOMMENDED_SKIP', `AI recommended not replying: ${g.reason_for_skip_or_review || 'no reason given'}`);
  }

  const evalRes = await callLlm(ctx, {
    stage: 'evaluate',
    system: EVALUATION_SYSTEM,
    user: evaluationUserPrompt({ community: conv.communityName, ctx: context, reply }),
    schema: evaluationSchema,
    schemaName: 'reply_evaluation',
  });
  const e = evalRes.data;
  const dims = [e.relevance, e.factual_support, e.specificity, e.clarity, e.tone].map(clamp01);
  const overall = (dims.reduce((a, b) => a + b, 0) / dims.length) * (1 - 0.5 * clamp01(e.repetition_risk));
  const passed =
    overall >= ctx.cfg.QUALITY_THRESHOLD &&
    !e.privacy_risk &&
    !e.unsupported_personal_experience &&
    !e.potentially_harmful_advice;
  const quality: QualityAssessment & { recommendedAction: GenerationOutput['recommended_action'] } = {
    relevance: dims[0]!,
    factualSupport: dims[1]!,
    specificity: dims[2]!,
    clarity: dims[3]!,
    tone: dims[4]!,
    repetitionRisk: clamp01(e.repetition_risk),
    promotionalContent: e.promotional_content,
    privacyRisk: e.privacy_risk,
    unsupportedPersonalExperience: e.unsupported_personal_experience,
    potentiallyHarmfulAdvice: e.potentially_harmful_advice,
    overallScore: Number(overall.toFixed(3)),
    passed,
    notes: e.notes,
    recommendedAction: g.recommended_action,
  };

  const findings = buildFindings(reply, brand, recent, ctx.cfg.DUPLICATE_SIMILARITY_THRESHOLD, { gen: g, evalOut: e });

  const draft = await ctx.db.replyDraft.create({
    data: {
      conversationId: conv.id,
      body: reply,
      originalBody: reply,
      contentHash: contentHash(reply),
      toneAssessment: g.tone_assessment,
      factualityAssessment: g.factual_support,
      promotionalAssessment: g.promotional_content_detected || e.promotional_content
        ? 'Promotional content flagged by the AI stages.'
        : 'No promotional content flagged by the AI stages.',
      qualityScore: quality.overallScore,
      quality: json(quality),
      detectorFindings: json(findings),
      brandRelevance: clamp01(g.brand_relevance),
      disclosureStatus: ctx.cfg.BOT_DISCLOSURE_TEXT ? 'INCLUDED' : 'NOT_CONFIGURED',
      model: `${ctx.llm.name}:${gen.model}`,
      promptVersion: PROMPT_VERSION,
    },
  });

  const policy = await evaluateDraftPolicy(ctx, draft.id, { trigger: 'automation' });
  await ctx.db.replyDraft.update({
    where: { id: draft.id },
    data: { policyDecision: policy.decision, policyEvaluation: json(policy) },
  });
  await ctx.db.conversation.update({
    where: { id: conv.id },
    data: { processingStatus: 'DRAFTED', eligibilityStatus: policy.decision, processedAt: ctx.now() },
  });
  await audit(ctx.db, {
    actorId,
    action: 'draft.generated',
    entityType: 'ReplyDraft',
    entityId: draft.id,
    policyVersion: policy.policyVersion,
    metadata: { decision: policy.decision, qualityScore: quality.overallScore, model: draft.model },
  });

  if (policy.decision === 'ELIGIBLE_FOR_AUTOMATION') {
    await requestPublish(ctx, { draftId: draft.id, actorId: null, trigger: 'automation' });
  }
  return { ...draft, policyDecision: policy.decision };
}

/** Deterministic detectors plus AI-stage flags (which can only add findings, never remove them). */
export function buildFindings(
  reply: string,
  brand: { name: string; verifiedFacts: string[]; prohibitedClaims: string[]; approvedUrls: string[] },
  priorReplies: { id: string; body: string }[],
  duplicateThreshold: number,
  ai?: { gen: GenerationOutput; evalOut: { promotional_content: boolean; unsupported_personal_experience: boolean; privacy_risk: boolean } },
): DetectorFinding[] {
  const findings = runDetectors(reply, {
    brand: brand.name === 'Unconfigured brand' ? null : brand,
    priorReplies,
    duplicateThreshold,
  });
  if (ai) {
    if (ai.gen.promotional_content_detected || ai.evalOut.promotional_content)
      findings.push({ detector: 'promotion', severity: 'review', message: 'AI stages flagged promotional content.' });
    if (ai.evalOut.unsupported_personal_experience)
      findings.push({ detector: 'personal_anecdote', severity: 'review', message: 'AI evaluator flagged unsupported personal experience.' });
    if (ai.evalOut.privacy_risk)
      findings.push({ detector: 'pii', severity: 'review', message: 'AI evaluator flagged a privacy risk.' });
    if (ai.gen.duplicate_risk === 'high')
      findings.push({ detector: 'duplicate', severity: 'review', message: 'AI generator flagged high duplicate risk.' });
  }
  return findings;
}

export function isRetryableLlmError(err: unknown): boolean {
  return err instanceof ProviderError && err.retryable;
}

import {
  approveDraftBody,
  draftListQuery,
  rejectDraftBody,
  type DraftDetail,
  type DraftSummary,
  type Paginated,
} from '@careerconnect/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../auth/auth.ts';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import { Prisma } from '../lib/db.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { contentHash } from '../policy/detectors.ts';
import { draftDetail, draftSummary } from '../services/dto.ts';
import { buildFindings } from '../services/pipeline.ts';
import { composePublishBody, evaluateDraftPolicy } from '../services/policy-context.ts';
import { requestPublish } from '../services/publish.ts';
import { getBrandProfile } from '../services/state.ts';

const idParams = z.object({ id: z.string().uuid() });
const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function loadDraftDetail(ctx: AppContext, id: string): Promise<DraftDetail> {
  const d = await ctx.db.replyDraft.findUnique({
    where: { id },
    include: { conversation: true, publishAttempts: true, reviewedBy: { select: { email: true } } },
  });
  if (!d) throw notFound('Draft');
  const brand = await getBrandProfile(ctx.db);
  const promotional = ((d.detectorFindings as { detector: string }[] | null) ?? []).some(
    (f) => f.detector === 'promotion' || f.detector === 'url',
  );
  const preview = composePublishBody(d.body, ctx.cfg.BOT_DISCLOSURE_TEXT, promotional && brand.disclosureText ? brand.disclosureText : null);
  return draftDetail(d, preview);
}

export const draftRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  app.get(
    '/',
    { schema: { tags: ['drafts'], querystring: draftListQuery }, preHandler: requireRole('VIEWER') },
    async (req): Promise<Paginated<DraftSummary>> => {
      const q = req.query;
      const where: Prisma.ReplyDraftWhereInput = {
        ...(q.reviewStatus ? { reviewStatus: q.reviewStatus } : {}),
        ...(q.publishStatus ? { publishStatus: q.publishStatus } : {}),
      };
      const [items, total] = await Promise.all([
        ctx.db.replyDraft.findMany({
          where,
          include: { conversation: true },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        ctx.db.replyDraft.count({ where }),
      ]);
      return { items: items.map(draftSummary), total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.get('/:id', { schema: { tags: ['drafts'], params: idParams }, preHandler: requireRole('VIEWER') }, async (req) =>
    loadDraftDetail(ctx, req.params.id),
  );

  app.post(
    '/:id/approve',
    { schema: { tags: ['drafts'], params: idParams, body: approveDraftBody }, preHandler: requireRole('REVIEWER') },
    async (req) => {
      const draft = await ctx.db.replyDraft.findUnique({ where: { id: req.params.id } });
      if (!draft) throw notFound('Draft');
      if (draft.publishStatus === 'PUBLISHED' || draft.publishStatus === 'QUEUED') {
        throw new AppError(409, 'DRAFT_LOCKED', `Draft is ${draft.publishStatus.toLowerCase()} and can no longer be edited.`);
      }
      const edited = req.body.body !== undefined && req.body.body !== draft.body;
      let findings = draft.detectorFindings as Prisma.InputJsonValue | null;
      if (edited) {
        // Re-run the deterministic detectors on the reviewer's text. AI-stage flags applied to the old text.
        const [brand, prior] = await Promise.all([
          getBrandProfile(ctx.db),
          ctx.db.replyDraft.findMany({
            where: { reviewStatus: { not: 'REJECTED' }, conversationId: { not: draft.conversationId } },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { id: true, body: true },
          }),
        ]);
        findings = json(buildFindings(req.body.body!, brand, prior, ctx.cfg.DUPLICATE_SIMILARITY_THRESHOLD));
      }
      await ctx.db.replyDraft.update({
        where: { id: draft.id },
        data: {
          ...(edited ? { body: req.body.body!, contentHash: contentHash(req.body.body!), detectorFindings: findings ?? Prisma.DbNull } : {}),
          reviewStatus: 'APPROVED',
          reviewNote: req.body.note ?? null,
          reviewedById: req.user!.id,
          reviewedAt: ctx.now(),
        },
      });
      const policy = await evaluateDraftPolicy(ctx, draft.id, { trigger: 'human_approved' });
      await ctx.db.replyDraft.update({ where: { id: draft.id }, data: { policyDecision: policy.decision, policyEvaluation: json(policy) } });
      await audit(ctx.db, {
        actorId: req.user!.id,
        action: 'draft.approved',
        entityType: 'ReplyDraft',
        entityId: draft.id,
        reason: req.body.note ?? null,
        policyVersion: policy.policyVersion,
        metadata: { edited, decision: policy.decision },
      });
      return loadDraftDetail(ctx, draft.id);
    },
  );

  app.post(
    '/:id/reject',
    { schema: { tags: ['drafts'], params: idParams, body: rejectDraftBody }, preHandler: requireRole('REVIEWER') },
    async (req) => {
      const draft = await ctx.db.replyDraft.findUnique({ where: { id: req.params.id } });
      if (!draft) throw notFound('Draft');
      if (draft.publishStatus === 'PUBLISHED') throw new AppError(409, 'ALREADY_PUBLISHED', 'Draft was already published.');
      const skip = req.body.kind === 'skip';
      await ctx.db.$transaction(async (tx) => {
        await tx.replyDraft.update({
          where: { id: draft.id },
          data: {
            reviewStatus: skip ? 'SKIPPED' : 'REJECTED',
            reviewNote: req.body.reason,
            reviewedById: req.user!.id,
            reviewedAt: ctx.now(),
          },
        });
        if (skip) {
          await tx.conversation.update({
            where: { id: draft.conversationId },
            data: { processingStatus: 'SKIPPED', eligibilityStatus: 'SKIP' },
          });
        }
        await audit(tx, {
          actorId: req.user!.id,
          action: skip ? 'draft.skipped' : 'draft.rejected',
          entityType: 'ReplyDraft',
          entityId: draft.id,
          reason: req.body.reason,
        });
      });
      // A queued job (if any) re-evaluates policy and will see the rejection.
      return loadDraftDetail(ctx, draft.id);
    },
  );

  app.post(
    '/:id/publish',
    {
      schema: {
        tags: ['drafts'],
        params: idParams,
        headers: z.object({ 'idempotency-key': z.string().trim().min(8).max(200).optional() }).passthrough(),
      },
      preHandler: requireRole('ADMIN'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const key = req.headers['idempotency-key'];
      return requestPublish(ctx, {
        draftId: req.params.id,
        actorId: req.user!.id,
        trigger: 'human_approved',
        idempotencyKey: typeof key === 'string' ? `user:${req.user!.id}:${key}` : undefined,
      });
    },
  );
};

import {
  auditListQuery,
  pauseBody,
  updatePlatformAuthorizationBody,
  type AuditEventDto,
  type Paginated,
  type PublishingStateDto,
} from '@careerconnect/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../auth/auth.ts';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import type { Prisma } from '../lib/db.ts';
import { platformDto } from '../services/dto.ts';
import { pausePublishing, resumePublishing } from '../services/publish.ts';
import { getPlatformAuthorization, publishingState } from '../services/state.ts';

export const adminRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  app.get('/admin/publishing', { schema: { tags: ['admin'] }, preHandler: requireRole('VIEWER') }, async () => publishingState(ctx));

  // Kill switch. Stops new publication immediately and removes queued jobs.
  app.post(
    '/admin/publishing/pause',
    { schema: { tags: ['admin'], body: pauseBody }, preHandler: requireRole('ADMIN') },
    async (req): Promise<PublishingStateDto> => {
      const { removed } = await pausePublishing(ctx, { actorId: req.user!.id, reason: req.body.reason });
      return { ...(await publishingState(ctx)), removedJobs: removed };
    },
  );

  // Clears the pause flag only; every publication is still re-checked against authorization and policy.
  app.post(
    '/admin/publishing/resume',
    { schema: { tags: ['admin'], body: pauseBody }, preHandler: requireRole('ADMIN') },
    async (req) => {
      await resumePublishing(ctx, { actorId: req.user!.id, reason: req.body.reason });
      return publishingState(ctx);
    },
  );

  const loadPlatform = async () => {
    const p = await getPlatformAuthorization(ctx.db);
    const by = p.reviewedById ? (await ctx.db.user.findUnique({ where: { id: p.reviewedById }, select: { email: true } }))?.email ?? null : null;
    return platformDto(p, by);
  };

  app.get('/admin/platform-authorization', { schema: { tags: ['admin'] }, preHandler: requireRole('VIEWER') }, loadPlatform);

  app.patch(
    '/admin/platform-authorization',
    { schema: { tags: ['admin'], body: updatePlatformAuthorizationBody }, preHandler: requireRole('ADMIN') },
    async (req) => {
      const before = await getPlatformAuthorization(ctx.db);
      const { reason, ...changes } = req.body;
      await ctx.db.platformAuthorization.update({
        where: { id: 'platform' },
        data: { ...changes, reviewedAt: ctx.now(), reviewedById: req.user!.id },
      });
      await audit(ctx.db, {
        actorId: req.user!.id,
        action: 'platform_authorization.updated',
        entityType: 'PlatformAuthorization',
        entityId: 'platform',
        reason,
        metadata: {
          before: {
            apiAccessAuthorized: before.apiAccessAuthorized,
            commercialUseApproved: before.commercialUseApproved,
            accountRegisteredAndLabeled: before.accountRegisteredAndLabeled,
          },
          changes,
        },
      });
      return loadPlatform();
    },
  );

  app.get(
    '/audit',
    { schema: { tags: ['admin'], querystring: auditListQuery }, preHandler: requireRole('ADMIN') },
    async (req): Promise<Paginated<AuditEventDto>> => {
      const q = req.query;
      const where: Prisma.AuditEventWhereInput = {
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.action ? { action: { contains: q.action } } : {}),
      };
      const [rows, total] = await Promise.all([
        ctx.db.auditEvent.findMany({
          where,
          include: { actor: { select: { email: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        ctx.db.auditEvent.count({ where }),
      ]);
      return {
        items: rows.map((e) => ({
          id: e.id,
          actorId: e.actorId,
          actorEmail: e.actor?.email ?? null,
          action: e.action,
          reason: e.reason,
          entityType: e.entityType,
          entityId: e.entityId,
          policyVersion: e.policyVersion,
          metadata: e.metadata,
          createdAt: e.createdAt.toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );
};

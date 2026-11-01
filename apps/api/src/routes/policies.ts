import { createPolicyBody, updatePolicyBody } from '@careerconnect/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../auth/auth.ts';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import { Prisma } from '../lib/db.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { policyDto } from '../services/dto.ts';

const idParams = z.object({ id: z.string().uuid() });

export const policyRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const toDto = (p: Parameters<typeof policyDto>[0]) => policyDto(p, ctx.now(), ctx.cfg.POLICY_MAX_AGE_DAYS);

  app.get('/', { schema: { tags: ['policies'] }, preHandler: requireRole('VIEWER') }, async () => {
    const rows = await ctx.db.subredditPolicy.findMany({ orderBy: { communityName: 'asc' } });
    return rows.map(toDto);
  });

  // New communities start fail-closed: UNKNOWN authorization, automation/promotion/discovery off, never reviewed.
  app.post('/', { schema: { tags: ['policies'], body: createPolicyBody }, preHandler: requireRole('ADMIN') }, async (req, reply) => {
    try {
      const p = await ctx.db.subredditPolicy.create({ data: { communityName: req.body.communityName.toLowerCase() } });
      await audit(ctx.db, { actorId: req.user!.id, action: 'policy.created', entityType: 'SubredditPolicy', entityId: p.id });
      reply.status(201);
      return toDto(p);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw conflict('Community already exists.');
      throw err;
    }
  });

  app.patch(
    '/:id',
    { schema: { tags: ['policies'], params: idParams, body: updatePolicyBody }, preHandler: requireRole('ADMIN') },
    async (req) => {
      const before = await ctx.db.subredditPolicy.findUnique({ where: { id: req.params.id } });
      if (!before) throw notFound('Community policy');
      const { reason, markReviewed, ...changes } = req.body;
      const after = await ctx.db.subredditPolicy.update({
        where: { id: before.id },
        data: {
          ...changes,
          ...(markReviewed ? { lastReviewedAt: ctx.now() } : {}),
          policyVersion: { increment: 1 },
        },
      });
      await audit(ctx.db, {
        actorId: req.user!.id,
        action: 'policy.updated',
        entityType: 'SubredditPolicy',
        entityId: after.id,
        reason,
        policyVersion: `community-${after.communityName}@v${after.policyVersion}`,
        metadata: { changes: { ...changes, markReviewed: !!markReviewed }, previousVersion: before.policyVersion },
      });
      return toDto(after);
    },
  );
};

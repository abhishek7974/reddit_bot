import { updateBrandProfileBody } from '@careerconnect/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../auth/auth.ts';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import { brandDto } from '../services/dto.ts';
import { getBrandProfile } from '../services/state.ts';

export const brandRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  app.get('/', { schema: { tags: ['brand'] }, preHandler: requireRole('VIEWER') }, async () => brandDto(await getBrandProfile(ctx.db)));

  app.patch('/', { schema: { tags: ['brand'], body: updateBrandProfileBody }, preHandler: requireRole('ADMIN') }, async (req) => {
    const before = await getBrandProfile(ctx.db);
    const { reason, ...changes } = req.body;
    if (changes.promotionCommunities) changes.promotionCommunities = changes.promotionCommunities.map((c) => c.toLowerCase());
    const after = await ctx.db.brandProfile.update({ where: { id: before.id }, data: changes });
    await audit(ctx.db, {
      actorId: req.user!.id,
      action: 'brand.updated',
      entityType: 'BrandProfile',
      entityId: after.id,
      reason,
      metadata: { fields: Object.keys(changes) },
    });
    return brandDto(after);
  });
};

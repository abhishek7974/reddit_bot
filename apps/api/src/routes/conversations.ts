import {
  conversationListQuery,
  discoverySettingsBody,
  type ConversationDetail,
  type ConversationUnderstanding,
  type DiscoveryRunResponse,
  type DiscoverySettingsDto,
  type Paginated,
  type ConversationSummary,
} from '@careerconnect/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole } from '../auth/auth.ts';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import type { Prisma } from '../lib/db.ts';
import { notFound } from '../lib/errors.ts';
import { contextOf, conversationSummary, draftSummary } from '../services/dto.ts';
import { generateDraft, understandConversation } from '../services/pipeline.ts';
import { purgeConversation } from '../services/retention.ts';
import { getDiscoverySettings } from '../services/state.ts';
import { loadDraftDetail } from './drafts.ts';

const idParams = z.object({ id: z.string().uuid() });

export const conversationRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  app.get(
    '/conversations',
    { schema: { tags: ['conversations'], querystring: conversationListQuery }, preHandler: requireRole('VIEWER') },
    async (req): Promise<Paginated<ConversationSummary>> => {
      const q = req.query;
      const where: Prisma.ConversationWhereInput = {
        ...(q.community ? { communityName: q.community.toLowerCase() } : {}),
        ...(q.topic ? { topic: q.topic } : {}),
        ...(q.eligibilityStatus ? { eligibilityStatus: q.eligibilityStatus } : {}),
        ...(q.processingStatus ? { processingStatus: q.processingStatus } : {}),
        ...(q.search
          ? { minimalPermittedContext: { path: ['title'], string_contains: q.search, mode: 'insensitive' } }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.db.conversation.findMany({
          where,
          orderBy: { discoveredAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { _count: { select: { drafts: true } } },
        }),
        ctx.db.conversation.count({ where }),
      ]);
      return { items: items.map(conversationSummary), total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.get(
    '/conversations/:id',
    { schema: { tags: ['conversations'], params: idParams }, preHandler: requireRole('VIEWER') },
    async (req): Promise<ConversationDetail> => {
      const c = await ctx.db.conversation.findUnique({
        where: { id: req.params.id },
        include: { drafts: { include: { conversation: true }, orderBy: { createdAt: 'desc' } }, _count: { select: { drafts: true } } },
      });
      if (!c) throw notFound('Conversation');
      return {
        ...conversationSummary(c),
        context: contextOf(c),
        understanding: c.understanding as unknown as ConversationUnderstanding | null,
        drafts: c.drafts.map(draftSummary),
      };
    },
  );

  app.post(
    '/conversations/:id/generate-draft',
    {
      schema: { tags: ['conversations'], params: idParams },
      preHandler: requireRole('REVIEWER'),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const conv = await ctx.db.conversation.findUnique({ where: { id: req.params.id } });
      if (!conv) throw notFound('Conversation');
      if (!conv.understanding) await understandConversation(ctx, conv.id);
      const draft = await generateDraft(ctx, conv.id, req.user!.id);
      return loadDraftDetail(ctx, draft.id);
    },
  );

  app.post(
    '/conversations/:id/purge',
    {
      schema: { tags: ['conversations'], params: idParams, body: z.object({ reason: z.string().trim().min(3).max(1000) }).nullish() },
      preHandler: requireRole('ADMIN'),
    },
    async (req) => {
      const conv = await ctx.db.conversation.findUnique({ where: { id: req.params.id } });
      if (!conv) throw notFound('Conversation');
      await purgeConversation(ctx, conv.id, req.user!.id, req.body?.reason ?? 'Manual purge by administrator');
      return { purged: true };
    },
  );

  app.post(
    '/discovery/run',
    {
      schema: { tags: ['discovery'] },
      preHandler: requireRole('REVIEWER'),
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req): Promise<DiscoveryRunResponse> => {
      if (!ctx.discovery) {
        return { queued: false, jobId: null, message: 'Discovery unavailable: LIVE mode without Reddit credentials.' };
      }
      const jobId = await ctx.queues.enqueueDiscovery(req.user!.id);
      await audit(ctx.db, { actorId: req.user!.id, action: 'discovery.requested', entityType: 'Discovery', entityId: jobId });
      return {
        queued: true,
        jobId,
        message: ctx.discovery.kind === 'mock' ? 'Discovery queued (synthetic demo data).' : 'Discovery queued (Reddit, read-only).',
      };
    },
  );

  const settingsDto = (s: Awaited<ReturnType<typeof getDiscoverySettings>>): DiscoverySettingsDto => ({
    keywords: s.keywords,
    exclusions: s.exclusions,
    topics: s.topics,
    maxPostsPerRun: s.maxPostsPerRun,
    minRelevanceForDraft: s.minRelevanceForDraft,
    updatedAt: s.updatedAt.toISOString(),
  });

  app.get('/discovery/settings', { schema: { tags: ['discovery'] }, preHandler: requireRole('VIEWER') }, async () =>
    settingsDto(await getDiscoverySettings(ctx.db)),
  );

  app.put(
    '/discovery/settings',
    { schema: { tags: ['discovery'], body: discoverySettingsBody }, preHandler: requireRole('ADMIN') },
    async (req) => {
      const { reason, ...data } = req.body;
      const before = await getDiscoverySettings(ctx.db);
      const after = await ctx.db.discoverySettings.update({ where: { id: 'discovery' }, data });
      await audit(ctx.db, {
        actorId: req.user!.id,
        action: 'discovery.settings_updated',
        entityType: 'DiscoverySettings',
        entityId: 'discovery',
        reason,
        metadata: { before: settingsDto(before), after: settingsDto(after) },
      });
      return settingsDto(after);
    },
  );
};

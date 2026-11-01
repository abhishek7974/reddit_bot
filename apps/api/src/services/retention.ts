import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import { Prisma } from '../lib/db.ts';

/**
 * Remove Reddit-derived text from a conversation while keeping the minimal audit skeleton
 * (ids, statuses, timestamps). Drafts that were never published are deleted; published drafts
 * keep only our own reply body for accountability.
 */
export async function purgeConversation(ctx: AppContext, conversationId: string, actorId: string | null, reason: string) {
  await ctx.db.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        minimalPermittedContext: Prisma.DbNull,
        understanding: Prisma.DbNull,
        contentHash: null,
        purgedAt: ctx.now(),
        processingStatus: 'PURGED',
      },
    });
    await tx.replyDraft.deleteMany({ where: { conversationId, publishStatus: { not: 'PUBLISHED' } } });
    await audit(tx, { actorId, action: 'conversation.purged', entityType: 'Conversation', entityId: conversationId, reason });
  });
}

/** Scheduled job: purge everything past its retention date. */
export async function purgeExpired(ctx: AppContext): Promise<number> {
  const expired = await ctx.db.conversation.findMany({
    where: { retentionExpiresAt: { lte: ctx.now() }, purgedAt: null },
    select: { id: true },
    take: 500,
  });
  for (const c of expired) await purgeConversation(ctx, c.id, null, 'Retention period expired');
  if (expired.length) ctx.log.info({ count: expired.length }, 'retention purge completed');
  return expired.length;
}

/** Purge stored content for posts that were removed or deleted upstream (deletion requests). */
export async function purgeRemovedUpstream(ctx: AppContext, limit = 100): Promise<number> {
  const provider = ctx.discovery;
  if (!provider) return 0;
  const candidates = await ctx.db.conversation.findMany({
    where: { purgedAt: null, dataSource: provider.kind === 'live' ? 'REDDIT' : 'SYNTHETIC' },
    orderBy: { discoveredAt: 'asc' },
    take: limit,
    select: { id: true, externalPostId: true },
  });
  let purged = 0;
  for (const c of candidates) {
    const status = await provider.getPostStatus(c.externalPostId).catch(() => null);
    if (status && !status.available && (status.reason === 'deleted' || status.reason === 'removed')) {
      await purgeConversation(ctx, c.id, null, `Post ${status.reason} upstream`);
      purged++;
    }
  }
  return purged;
}

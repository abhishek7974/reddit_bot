import type { ConversationContext } from '@careerconnect/shared';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import { Prisma } from '../lib/db.ts';
import { contentHash } from '../policy/detectors.ts';
import { getDiscoverySettings, getPlatformAuthorization } from './state.ts';

const EXCERPT_CHARS = 1200;
const TOP_COMMENTS = 3;

export interface DiscoveryResult {
  communitiesScanned: string[];
  communitiesSkipped: { community: string; reason: string }[];
  fetched: number;
  created: number;
  duplicates: number;
  filtered: number;
}

/**
 * Read-only discovery. A community is only accessed when its policy record has discovery enabled
 * and — for live Reddit — both platform API access and the community authorization are APPROVED.
 */
export async function runDiscovery(ctx: AppContext, actorId: string | null): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { communitiesScanned: [], communitiesSkipped: [], fetched: 0, created: 0, duplicates: 0, filtered: 0 };
  const provider = ctx.discovery;
  if (!provider) {
    result.communitiesSkipped.push({ community: '*', reason: 'No discovery provider: LIVE mode without Reddit credentials.' });
    return result;
  }
  const live = provider.kind === 'live';
  const [settings, platform, policies] = await Promise.all([
    getDiscoverySettings(ctx.db),
    getPlatformAuthorization(ctx.db),
    ctx.db.subredditPolicy.findMany({ where: { discoveryEnabled: true } }),
  ]);

  if (live && platform.apiAccessAuthorized !== 'APPROVED') {
    result.communitiesSkipped.push({ community: '*', reason: `Reddit API access is ${platform.apiAccessAuthorized}.` });
    await audit(ctx.db, { actorId, action: 'discovery.blocked', entityType: 'Discovery', reason: 'API access not authorized' });
    return result;
  }

  const keywords = settings.keywords.map((k) => k.toLowerCase());
  const exclusions = settings.exclusions.map((k) => k.toLowerCase());
  const retentionExpiresAt = new Date(ctx.now().getTime() + ctx.cfg.RETENTION_DAYS * 86_400_000);

  for (const policy of policies) {
    if (live && policy.communityName.startsWith('demo_')) {
      result.communitiesSkipped.push({ community: policy.communityName, reason: 'Synthetic demo community; never queried on Reddit.' });
      continue;
    }
    if (live && policy.authorizationStatus !== 'APPROVED') {
      result.communitiesSkipped.push({ community: policy.communityName, reason: `Community authorization is ${policy.authorizationStatus}.` });
      continue;
    }
    if (!live && !policy.communityName.startsWith('demo_')) {
      result.communitiesSkipped.push({ community: policy.communityName, reason: 'Synthetic mode only scans demo_ communities.' });
      continue;
    }
    result.communitiesScanned.push(policy.communityName);
    const posts = await provider.listNewPosts(policy.communityName, settings.maxPostsPerRun);
    result.fetched += posts.length;

    for (const post of posts) {
      if (post.removedOrDeleted || post.locked) {
        result.filtered++;
        continue;
      }
      const text = `${post.title}\n${post.body}`.toLowerCase();
      if (exclusions.some((x) => text.includes(x)) || (keywords.length > 0 && !keywords.some((k) => text.includes(k)))) {
        result.filtered++;
        continue;
      }
      const dataSource = live ? 'REDDIT' : 'SYNTHETIC';
      const exists = await ctx.db.conversation.findUnique({
        where: { dataSource_externalPostId: { dataSource, externalPostId: post.externalId } },
        select: { id: true },
      });
      if (exists) {
        result.duplicates++;
        continue;
      }
      const topComments = (await provider.getTopComments(post.externalId, TOP_COMMENTS)).map((c) => c.slice(0, 400));
      const context: ConversationContext = {
        title: post.title.slice(0, 300),
        excerpt: post.body.slice(0, EXCERPT_CHARS),
        permalink: post.permalink,
        topComments,
      };
      try {
        const conv = await ctx.db.conversation.create({
          data: {
            externalPostId: post.externalId,
            dataSource,
            communityName: policy.communityName,
            minimalPermittedContext: context as unknown as Prisma.InputJsonValue,
            contentHash: contentHash(`${post.title}\n${post.body}`),
            postCreatedAt: post.createdAt,
            retentionExpiresAt,
          },
        });
        result.created++;
        await ctx.queues.enqueueAnalysis(conv.id);
      } catch (err) {
        // Unique constraint race with a concurrent discovery run: treat as duplicate.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') result.duplicates++;
        else throw err;
      }
    }
  }

  await audit(ctx.db, {
    actorId,
    action: 'discovery.completed',
    entityType: 'Discovery',
    metadata: { ...result, source: provider.kind },
  });
  return result;
}

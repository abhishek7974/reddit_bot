import {
  metricsQuery,
  type CareerTopic,
  type DashboardSummary,
  type DataSource,
  type MetricPoint,
  type MetricsResponse,
  type SystemHealth,
} from '@careerconnect/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../auth/auth.ts';
import { APP_VERSION, redditCredentialsPresent } from '../config.ts';
import type { AppContext } from '../context.ts';
import { Prisma } from '../lib/db.ts';
import { publishingState } from '../services/state.ts';

const COST_WINDOW_DAYS = 30;

/** Policy incidents: blocked-at-execution, permanent failures and automatic pauses. */
const INCIDENT_WHERE = (since: Date): Prisma.AuditEventWhereInput => ({
  createdAt: { gte: since },
  OR: [
    { action: { in: ['publish.blocked_at_execution', 'publish.failed'] } },
    { action: 'publishing.paused', actorId: null },
  ],
});

export const dashboardRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  app.get('/dashboard/summary', { schema: { tags: ['dashboard'] }, preHandler: requireRole('VIEWER') }, async (): Promise<DashboardSummary> => {
    const db = ctx.db;
    const since = new Date(ctx.now().getTime() - COST_WINDOW_DAYS * 86_400_000);
    const [
      discovered, relevant, drafts, awaiting, published, simulated, evaluated, failedQuality,
      negative, incidents, usage, sources,
    ] = await Promise.all([
      db.conversation.count(),
      db.conversation.count({ where: { eligibilityStatus: { in: ['HOLD_FOR_REVIEW', 'ELIGIBLE_FOR_AUTOMATION'] } } }),
      db.replyDraft.count(),
      db.replyDraft.count({ where: { reviewStatus: 'PENDING_REVIEW', publishStatus: { not: 'PUBLISHED' } } }),
      db.publishAttempt.count({ where: { status: 'SUCCEEDED' } }),
      db.publishAttempt.count({ where: { status: 'SIMULATED' } }),
      db.replyDraft.count({ where: { qualityScore: { not: null } } }),
      db.replyDraft.count({ where: { quality: { path: ['passed'], equals: false } } }),
      db.campaignMetric.aggregate({ where: { metricName: 'negative_feedback' }, _sum: { metricValue: true } }),
      db.auditEvent.count({ where: INCIDENT_WHERE(since) }),
      db.llmUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } }),
      db.conversation.findMany({ distinct: ['dataSource'], select: { dataSource: true } }),
    ]);
    const inTok = usage._sum.inputTokens ?? 0;
    const outTok = usage._sum.outputTokens ?? 0;
    const pin = ctx.cfg.LLM_PRICE_INPUT_PER_MTOK;
    const pout = ctx.cfg.LLM_PRICE_OUTPUT_PER_MTOK;
    const priced = pin !== undefined && pout !== undefined;
    return {
      mode: ctx.cfg.APP_MODE,
      dataSources: sources.map((s) => s.dataSource as DataSource),
      conversationsDiscovered: discovered,
      relevantConversations: relevant,
      draftsGenerated: drafts,
      draftsAwaitingReview: awaiting,
      repliesPublished: published,
      simulatedPublications: simulated,
      qualityRejectionRate: evaluated ? failedQuality / evaluated : null,
      negativeFeedback: negative._sum.metricValue ?? 0,
      policyIncidents: incidents,
      cost: {
        configured: priced,
        inputTokens: inTok,
        outputTokens: outTok,
        estimatedUsd: priced ? Number(((inTok * pin) / 1e6 + (outTok * pout) / 1e6).toFixed(4)) : null,
        windowDays: COST_WINDOW_DAYS,
      },
      publishing: await publishingState(ctx),
    };
  });

  app.get('/metrics', { schema: { tags: ['dashboard'], querystring: metricsQuery }, preHandler: requireRole('VIEWER') }, async (req): Promise<MetricsResponse> => {
    const days = req.query.days;
    const since = new Date(ctx.now().getTime() - days * 86_400_000);
    const series = async (table: Prisma.Sql, column: Prisma.Sql, extra: Prisma.Sql = Prisma.empty): Promise<MetricPoint[]> => {
      const rows = await ctx.db.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', ${column}) AS day, COUNT(*)::bigint AS n
        FROM ${table} WHERE ${column} >= ${since} ${extra}
        GROUP BY 1 ORDER BY 1`;
      return rows.map((r) => ({ date: r.day.toISOString().slice(0, 10), value: Number(r.n) }));
    };
    const [conv, drafts, pubs, rejections, topics, communities, engagement] = await Promise.all([
      series(Prisma.sql`"Conversation"`, Prisma.sql`"discoveredAt"`),
      series(Prisma.sql`"ReplyDraft"`, Prisma.sql`"createdAt"`),
      series(Prisma.sql`"PublishAttempt"`, Prisma.sql`"completedAt"`, Prisma.sql`AND status IN ('SUCCEEDED','SIMULATED')`),
      series(Prisma.sql`"ReplyDraft"`, Prisma.sql`"createdAt"`, Prisma.sql`AND (quality->>'passed') = 'false'`),
      ctx.db.conversation.groupBy({ by: ['topic'], where: { discoveredAt: { gte: since }, topic: { not: null } }, _count: { _all: true } }),
      ctx.db.$queryRaw<{ communityName: string; count: bigint; published: bigint }[]>`
        SELECT c."communityName", COUNT(*)::bigint AS count,
               COUNT(*) FILTER (WHERE c."processingStatus" = 'PUBLISHED')::bigint AS published
        FROM "Conversation" c WHERE c."discoveredAt" >= ${since}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
      ctx.db.campaignMetric.groupBy({
        by: ['metricName', 'attributionMethod'],
        where: { measuredAt: { gte: since } },
        _sum: { metricValue: true },
      }),
    ]);
    return {
      windowDays: days,
      series: { conversationsDiscovered: conv, draftsGenerated: drafts, repliesPublished: pubs, qualityRejections: rejections },
      engagement: engagement.map((e) => ({ metricName: e.metricName, total: e._sum.metricValue ?? 0, attributionMethod: e.attributionMethod })),
      topicBreakdown: topics.map((t) => ({ topic: t.topic as CareerTopic, count: t._count._all })).sort((a, b) => b.count - a.count),
      communityBreakdown: communities.map((c) => ({ communityName: c.communityName, count: Number(c.count), published: Number(c.published) })),
    };
  });

  app.get('/system/health', { schema: { tags: ['system'] }, preHandler: requireRole('VIEWER') }, async (): Promise<SystemHealth> => {
    const timed = async (fn: () => Promise<unknown>) => {
      const start = Date.now();
      try {
        await fn();
        return { ok: true, latencyMs: Date.now() - start };
      } catch (err) {
        return { ok: false, latencyMs: null, error: (err as Error).message.slice(0, 200) };
      }
    };
    const [database, redis] = await Promise.all([timed(() => ctx.db.$queryRaw`SELECT 1`), timed(() => ctx.queues.ping())]);
    const [queues, failedJobs] = redis.ok ? await Promise.all([ctx.queues.stats(), ctx.queues.failedJobs(20)]) : [[], []];
    const dayAgo = new Date(ctx.now().getTime() - 86_400_000);
    const usage = await ctx.db.llmUsage.aggregate({ where: { createdAt: { gte: dayAgo } }, _sum: { inputTokens: true, outputTokens: true }, _count: true });

    let reddit: SystemHealth['reddit'];
    if (!ctx.discovery) reddit = { configured: false, mode: 'disabled', lastCheckOk: null, detail: 'No Reddit provider (LIVE mode without credentials).' };
    else if (ctx.discovery.kind === 'mock') reddit = { configured: redditCredentialsPresent(ctx.cfg), mode: 'mock', lastCheckOk: true, detail: 'Synthetic data provider; no Reddit calls are made.' };
    else {
      const check = await ctx.discovery.checkConnectivity();
      reddit = { configured: true, mode: 'live', lastCheckOk: check.ok, detail: check.detail };
    }
    const publishing = await publishingState(ctx);
    return {
      status: database.ok && redis.ok ? 'ok' : 'degraded',
      mode: ctx.cfg.APP_MODE,
      version: APP_VERSION,
      database,
      redis,
      reddit,
      llm: { provider: ctx.llm.name, configured: ctx.llm.configured, models: ctx.llm.models },
      queues,
      failedJobs,
      tokenUsage: { last24h: { inputTokens: usage._sum.inputTokens ?? 0, outputTokens: usage._sum.outputTokens ?? 0, calls: usage._count } },
      publishing,
    };
  });
};

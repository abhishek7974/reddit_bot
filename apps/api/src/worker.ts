import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { createAppContext } from './bootstrap.ts';
import type { AppContext } from './context.ts';
import { AppError, ProviderError } from './lib/errors.ts';
import { PUBLISH_MAX_ATTEMPTS, QUEUE_PREFIX } from './queues/bullmq.ts';
import { runDiscovery } from './services/discovery.ts';
import { analyzeConversation } from './services/pipeline.ts';
import { processPublishAttempt } from './services/publish.ts';
import { purgeExpired, purgeRemovedUpstream } from './services/retention.ts';

const MAX_BACKOFF_MS = 15 * 60_000;

/** Exponential backoff that honors server-provided Retry-After when present. */
export function publishBackoff(attemptsMade: number, err?: Error): number {
  const hinted = (err as { retryAfterMs?: number } | undefined)?.retryAfterMs;
  const exp = Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.max(0, attemptsMade - 1));
  return Math.min(MAX_BACKOFF_MS, Math.max(hinted ?? 0, exp));
}

class RetryablePublishError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

export async function handlePublishJob(ctx: AppContext, job: Pick<Job, 'data' | 'attemptsMade' | 'opts'>) {
  const attempts = job.opts.attempts ?? PUBLISH_MAX_ATTEMPTS;
  const finalAttempt = job.attemptsMade + 1 >= attempts;
  const outcome = await processPublishAttempt(ctx, job.data.attemptId as string, { finalAttempt });
  switch (outcome.kind) {
    case 'retry':
      throw new RetryablePublishError(`${outcome.error.category}: ${outcome.error.message}`, outcome.error.retryAfterMs);
    case 'failed':
      throw new UnrecoverableError(`${outcome.error.category}: ${outcome.error.message}`);
    default:
      return outcome;
  }
}

function startWorkers(ctx: AppContext, connection: ReturnType<typeof createAppContext>['redis']) {
  const log = ctx.log;
  const workers = [
    new Worker('discovery', async (job) => runDiscovery(ctx, (job.data?.requestedBy as string | null) ?? null), {
      connection,
      prefix: QUEUE_PREFIX,
      concurrency: 1,
    }),
    new Worker(
      'analysis',
      async (job) => {
        try {
          return await analyzeConversation(ctx, job.data.conversationId as string);
        } catch (err) {
          const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
          const permanent = (err instanceof ProviderError && !err.retryable) || err instanceof AppError;
          if (final || permanent) {
            await ctx.db.conversation.update({ where: { id: job.data.conversationId }, data: { processingStatus: 'FAILED' } }).catch(() => {});
          }
          if (permanent) throw new UnrecoverableError((err as Error).message);
          throw err;
        }
      },
      { connection, prefix: QUEUE_PREFIX, concurrency: 2 },
    ),
    // Publication runs one job at a time to keep ordering and rate accounting simple.
    new Worker('publish', async (job) => handlePublishJob(ctx, job), {
      connection,
      prefix: QUEUE_PREFIX,
      concurrency: 1,
      settings: { backoffStrategy: (attemptsMade, _type, err) => publishBackoff(attemptsMade, err) },
    }),
    new Worker(
      'maintenance',
      async (job) => {
        if (job.name === 'retention') return { expired: await purgeExpired(ctx), removedUpstream: await purgeRemovedUpstream(ctx) };
        if (job.name === 'scheduled-discovery') return ctx.queues.enqueueDiscovery(null);
        return null;
      },
      { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
    ),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => log.warn({ queue: w.name, jobId: job?.id, err: err.message }, 'job failed'));
    w.on('error', (err) => log.error({ queue: w.name, err: err.message }, 'worker error'));
  }
  return workers;
}

async function main() {
  const { ctx, redis, queues } = createAppContext();
  const workers = startWorkers(ctx, redis);

  // Repeatable maintenance jobs (idempotent upserts).
  await queues.queues.maintenance.upsertJobScheduler('retention', { every: 6 * 3_600_000 }, { name: 'retention' });
  if (ctx.cfg.DISCOVERY_INTERVAL_MINUTES > 0) {
    await queues.queues.maintenance.upsertJobScheduler(
      'scheduled-discovery',
      { every: ctx.cfg.DISCOVERY_INTERVAL_MINUTES * 60_000 },
      { name: 'scheduled-discovery' },
    );
  } else {
    await queues.queues.maintenance.removeJobScheduler('scheduled-discovery');
  }

  ctx.log.info({ mode: ctx.cfg.APP_MODE, llm: ctx.llm.name, reddit: ctx.discovery?.kind ?? 'disabled' }, 'CareerConnect worker ready');

  const shutdown = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await queues.close();
    redis.disconnect();
    await ctx.db.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

if (process.env.VITEST === undefined) await main();

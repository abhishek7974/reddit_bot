import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES, type FailedJobInfo, type JobQueues, type QueueName, type QueueStats } from './types.ts';

export const PUBLISH_MAX_ATTEMPTS = 5;
/** Namespaces all BullMQ keys so a shared Redis cannot mix our jobs with another app's. */
export const QUEUE_PREFIX = 'careerconnect';

export function createRedis(url: string): Redis {
  // maxRetriesPerRequest: null is required by BullMQ for blocking connections.
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

const DEFAULTS: Record<QueueName, JobsOptions> = {
  discovery: { attempts: 2, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 100, removeOnFail: 200 },
  analysis: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 500, removeOnFail: 500 },
  // Retry delays for publish come from the worker's backoffStrategy (honors Retry-After).
  publish: { attempts: PUBLISH_MAX_ATTEMPTS, backoff: { type: 'publish' }, removeOnComplete: 1000, removeOnFail: 1000 },
  maintenance: { attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
};

export class BullQueues implements JobQueues {
  readonly queues: Record<QueueName, Queue>;

  constructor(private redis: Redis) {
    this.queues = Object.fromEntries(
      QUEUE_NAMES.map((name) => [name, new Queue(name, { connection: redis, prefix: QUEUE_PREFIX, defaultJobOptions: DEFAULTS[name] })]),
    ) as Record<QueueName, Queue>;
  }

  async enqueueDiscovery(requestedBy: string | null) {
    const job = await this.queues.discovery.add('run', { requestedBy });
    return job.id ?? null;
  }

  async enqueueAnalysis(conversationId: string) {
    await this.queues.analysis.add('analyze', { conversationId }, { jobId: `analyze-${conversationId}` });
  }

  async enqueuePublish(attemptId: string) {
    await this.queues.publish.add('publish', { attemptId }, { jobId: attemptId });
  }

  async removePendingPublishJobs() {
    const jobs = await this.queues.publish.getJobs(['waiting', 'delayed', 'prioritized']);
    let removed = 0;
    for (const job of jobs) {
      try {
        await job.remove();
        removed++;
      } catch {
        // Job became active between listing and removal; the worker re-checks the kill switch.
      }
    }
    return removed;
  }

  async stats(): Promise<QueueStats[]> {
    return Promise.all(
      QUEUE_NAMES.map(async (name) => {
        const c = await this.queues[name].getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
        return {
          name,
          waiting: c.waiting ?? 0,
          active: c.active ?? 0,
          delayed: c.delayed ?? 0,
          failed: c.failed ?? 0,
          completed: c.completed ?? 0,
        };
      }),
    );
  }

  async failedJobs(limit: number): Promise<FailedJobInfo[]> {
    const out: FailedJobInfo[] = [];
    for (const name of QUEUE_NAMES) {
      const jobs = await this.queues[name].getFailed(0, limit - 1);
      for (const j of jobs) {
        out.push({
          queue: name,
          id: String(j.id),
          name: j.name,
          failedReason: (j.failedReason ?? '').slice(0, 300),
          finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        });
      }
    }
    return out.sort((a, b) => (b.finishedOn ?? '').localeCompare(a.finishedOn ?? '')).slice(0, limit);
  }

  async ping() {
    const start = Date.now();
    await this.redis.ping();
    return Date.now() - start;
  }

  async close() {
    await Promise.all(Object.values(this.queues).map((q) => q.close()));
  }
}

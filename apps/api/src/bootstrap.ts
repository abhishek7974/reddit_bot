import * as Sentry from '@sentry/node';
import { loadConfig, type AppConfig } from './config.ts';
import { createRedditProviders, type AppContext } from './context.ts';
import { createDb } from './lib/db.ts';
import { createLogger } from './lib/logger.ts';
import { createLlmProvider } from './llm/provider.ts';
import { BullQueues, createRedis } from './queues/bullmq.ts';

/** Build the production dependency container (real Postgres, Redis, configured providers). */
export function createAppContext(cfg: AppConfig = loadConfig()) {
  if (cfg.SENTRY_DSN) {
    Sentry.init({ dsn: cfg.SENTRY_DSN, environment: cfg.NODE_ENV, sendDefaultPii: false, tracesSampleRate: 0 });
  }
  const log = createLogger(cfg);
  const db = createDb(cfg.DATABASE_URL);
  const redis = createRedis(cfg.REDIS_URL);
  const queues = new BullQueues(redis);
  const ctx: AppContext = {
    cfg,
    db,
    log,
    llm: createLlmProvider(cfg),
    queues,
    ...createRedditProviders(cfg, log),
    now: () => new Date(),
  };
  if (cfg.APP_MODE === 'LIVE' && !ctx.livePublisher) {
    log.warn('APP_MODE=LIVE but Reddit credentials are missing: publication and discovery are disabled.');
  }
  return { ctx, redis, queues };
}

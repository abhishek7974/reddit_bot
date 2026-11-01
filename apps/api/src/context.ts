import { redditCredentialsPresent, type AppConfig } from './config.ts';
import type { Db } from './lib/db.ts';
import type { Logger } from './lib/logger.ts';
import type { LlmProvider } from './llm/provider.ts';
import { LiveRedditProvider } from './reddit/live.ts';
import { MockRedditProvider } from './reddit/mock.ts';
import type { RedditProvider } from './reddit/types.ts';
import type { JobQueues } from './queues/types.ts';

/** Explicit dependency container shared by routes, services and workers. */
export interface AppContext {
  cfg: AppConfig;
  db: Db;
  log: Logger;
  llm: LlmProvider;
  queues: JobQueues;
  /** Source of conversations: mock fixtures, live Reddit (read), or null when discovery is impossible. */
  discovery: RedditProvider | null;
  /** Used only for simulated publication of SYNTHETIC conversations in DEMO mode. */
  simulationPublisher: RedditProvider;
  /** Used only for real publication in LIVE mode; null when credentials are missing. */
  livePublisher: RedditProvider | null;
  now: () => Date;
}

export function createRedditProviders(cfg: AppConfig, log: Logger, mock = new MockRedditProvider()) {
  const live = cfg.APP_MODE !== 'DEMO' && redditCredentialsPresent(cfg) ? new LiveRedditProvider(cfg, log) : null;
  // DEMO always uses synthetic data. DRAFT_ONLY without credentials also uses synthetic data so the
  // review workflow can be exercised; it never publishes. LIVE without credentials cannot discover.
  const discovery: RedditProvider | null =
    cfg.APP_MODE === 'DEMO' ? mock : live ?? (cfg.APP_MODE === 'DRAFT_ONLY' ? mock : null);
  return {
    discovery,
    simulationPublisher: mock,
    livePublisher: cfg.APP_MODE === 'LIVE' ? live : null,
  };
}

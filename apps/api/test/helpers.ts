import { CSRF_HEADER } from '@careerconnect/shared';
import { config as loadEnv } from 'dotenv';
import { hashPassword } from '../src/auth/auth.ts';
import { buildApp, type App } from '../src/app.ts';
import { loadConfig, type AppConfig } from '../src/config.ts';
import type { AppContext } from '../src/context.ts';
import { createDb, type Db } from '../src/lib/db.ts';
import { createLogger } from '../src/lib/logger.ts';
import { MockLlmProvider } from '../src/llm/mock.ts';
import type { LlmProvider } from '../src/llm/provider.ts';
import { InMemoryQueues } from '../src/queues/types.ts';
import { MockRedditProvider } from '../src/reddit/mock.ts';
import type { RedditProvider } from '../src/reddit/types.ts';

loadEnv({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true });

export const TEST_PASSWORD = 'correct-horse-battery-staple';

let sharedDb: Db | null = null;
export function testDb(): Db {
  sharedDb ??= createDb(process.env.TEST_DATABASE_URL!);
  return sharedDb;
}

export function testConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_MODE: 'DEMO',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    LLM_PROVIDER: 'mock',
    BOT_DISCLOSURE_TEXT: 'I am an automated assistant.',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export interface TestContext extends AppContext {
  queues: InMemoryQueues;
  mockReddit: MockRedditProvider;
}

export function makeCtx(
  cfgOverrides: Partial<Record<keyof AppConfig, string>> = {},
  opts: { livePublisher?: RedditProvider | null; discovery?: RedditProvider | null; llm?: LlmProvider; now?: () => Date } = {},
): TestContext {
  const cfg = testConfig(cfgOverrides);
  const mockReddit = new MockRedditProvider();
  return {
    cfg,
    db: testDb(),
    log: createLogger(cfg),
    llm: opts.llm ?? new MockLlmProvider(),
    queues: new InMemoryQueues(),
    discovery: opts.discovery === undefined ? mockReddit : opts.discovery,
    simulationPublisher: mockReddit,
    livePublisher: opts.livePublisher ?? null,
    mockReddit,
    now: opts.now ?? (() => new Date()),
  };
}

export async function resetDb(db: Db) {
  await db.$executeRawUnsafe(`TRUNCATE "PublishAttempt", "ReplyDraft", "Conversation", "AuditEvent", "Session", "User",
    "SubredditPolicy", "BrandProfile", "CampaignMetric", "LlmUsage", "SystemState", "PlatformAuthorization", "DiscoverySettings" CASCADE`);
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

/** Fixture state mirroring the demo seed, with publishing UNPAUSED unless stated. */
export async function seedBase(db: Db, opts: { paused?: boolean } = {}) {
  const pw = await hashPassword(TEST_PASSWORD);
  await db.user.createMany({
    data: [
      { email: 'admin@test.local', passwordHash: pw, role: 'ADMIN' },
      { email: 'reviewer@test.local', passwordHash: pw, role: 'REVIEWER' },
      { email: 'viewer@test.local', passwordHash: pw, role: 'VIEWER' },
    ],
  });
  await db.systemState.create({ data: { id: 'system', globalPause: opts.paused ?? false, pauseReason: null } });
  await db.platformAuthorization.create({ data: { id: 'platform' } });
  await db.discoverySettings.create({ data: { id: 'discovery', minRelevanceForDraft: 0.6 } });
  await db.brandProfile.create({
    data: {
      name: 'CareerConnect',
      description: 'Test brand',
      verifiedFacts: ['CareerConnect offers a free resume checklist.'],
      prohibitedClaims: ['guaranteed job offer'],
      approvedUrls: ['https://careerconnect.example'],
      disclosureText: 'Disclosure: mentions our product.',
    },
  });
  await db.subredditPolicy.createMany({
    data: [
      { communityName: 'demo_careeradvice', ruleSummary: 'Allowed if labeled', authorizationStatus: 'APPROVED', automationAllowed: true, discoveryEnabled: true, lastReviewedAt: daysAgo(1) },
      { communityName: 'demo_resumes', ruleSummary: 'No bots', authorizationStatus: 'APPROVED', automationAllowed: false, discoveryEnabled: true, lastReviewedAt: daysAgo(1) },
      { communityName: 'demo_cscareers', ruleSummary: 'Stale', authorizationStatus: 'APPROVED', automationAllowed: true, discoveryEnabled: true, lastReviewedAt: daysAgo(90) },
      { communityName: 'demo_unreviewed', ruleSummary: '', authorizationStatus: 'UNKNOWN', discoveryEnabled: true },
    ],
  });
}

export class Client {
  cookie = '';
  csrf = '';
  constructor(private app: App) {}

  async login(email: string, password = TEST_PASSWORD) {
    const res = await this.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    this.cookie = raw?.split(';')[0] ?? '';
    this.csrf = res.json().csrfToken ?? '';
    return res;
  }

  req(method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) {
    return this.app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: { cookie: this.cookie, [CSRF_HEADER]: this.csrf, ...headers },
    });
  }
}

export async function appFor(ctx: AppContext) {
  return buildApp(ctx, { logger: false });
}

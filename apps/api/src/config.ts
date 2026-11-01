import { z } from 'zod';
import { APP_MODES } from '@careerconnect/shared';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalPositiveInt = z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional());
const optionalPositiveNumber = z.preprocess(emptyToUndefined, z.coerce.number().positive().optional());
const bool = (def: boolean) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true'), z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_MODE: z.enum(APP_MODES).default('DEMO'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 7).default(12),
  COOKIE_SECURE: bool(false),

  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'mock']).default('mock'),
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  LLM_MODEL_CLASSIFY: optionalString,
  LLM_MODEL_GENERATE: optionalString,
  LLM_MODEL_EVALUATE: optionalString,
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1200),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LLM_PRICE_INPUT_PER_MTOK: optionalPositiveNumber,
  LLM_PRICE_OUTPUT_PER_MTOK: optionalPositiveNumber,
  LLM_DAILY_TOKEN_BUDGET: optionalPositiveInt,

  REDDIT_CLIENT_ID: optionalString,
  REDDIT_CLIENT_SECRET: optionalString,
  REDDIT_REFRESH_TOKEN: optionalString,
  REDDIT_USER_AGENT: optionalString,

  BOT_DISCLOSURE_TEXT: optionalString,
  PUBLISH_MAX_PER_HOUR: optionalPositiveInt,
  PUBLISH_MAX_PER_DAY: optionalPositiveInt,
  PUBLISH_MAX_PER_COMMUNITY_PER_DAY: optionalPositiveInt,
  PUBLISH_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(3),
  PUBLISHING_HARD_DISABLED: bool(false),

  POLICY_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  QUALITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  DUPLICATE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  DISCOVERY_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(0),

  SENTRY_DSN: optionalString,
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && !cfg.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production.');
  }
  return cfg;
}

export function redditCredentialsPresent(cfg: AppConfig): boolean {
  return Boolean(
    cfg.REDDIT_CLIENT_ID && cfg.REDDIT_CLIENT_SECRET && cfg.REDDIT_REFRESH_TOKEN && cfg.REDDIT_USER_AGENT,
  );
}

export const APP_VERSION = '0.1.0';

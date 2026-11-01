import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createRedditProviders } from '../src/context.ts';
import { createDb } from '../src/lib/db.ts';
import { createLogger } from '../src/lib/logger.ts';
import { MockLlmProvider } from '../src/llm/mock.ts';
import { InMemoryQueues } from '../src/queues/types.ts';

// Builds the app without connecting to anything and writes the OpenAPI document to docs/openapi.json.
const cfg = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgresql://unused/none' } as NodeJS.ProcessEnv);
const log = createLogger(cfg);
const app = await buildApp(
  { cfg, db: createDb(cfg.DATABASE_URL), log, llm: new MockLlmProvider(), queues: new InMemoryQueues(), ...createRedditProviders(cfg, log), now: () => new Date() },
  { logger: false },
);
await app.ready();
const out = new URL('../../../docs/openapi.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
console.log(`Wrote ${out.pathname}`);
await app.close();

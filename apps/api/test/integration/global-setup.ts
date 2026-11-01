import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });

/** Apply migrations to the dedicated test database. Never point this at a real database. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/careerconnect_test';
  if (!/test/i.test(url)) throw new Error(`Refusing to run integration tests against non-test database: ${url}`);
  process.env.TEST_DATABASE_URL = url;
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
    cwd: new URL('../..', import.meta.url).pathname,
  });
}

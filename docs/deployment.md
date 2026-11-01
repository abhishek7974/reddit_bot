# Deployment guide

CareerConnect runs as four processes, all from two images:

| Process | Image | Command | Scale |
|---------|-------|---------|-------|
| `migrate` (one-off, each release) | `apps/api/Dockerfile --target migrate` | `prisma migrate deploy` | 1, before api/worker |
| `api` | `apps/api/Dockerfile --target runtime` | `node dist/server.js` | 1+ (stateless) |
| `worker` | same as api | `node dist/worker.js` | **1** (publish concurrency is 1 per worker; running several workers is safe because attempts are claimed atomically, but keep 1 for predictable rate accounting) |
| `web` | `apps/web/Dockerfile` | `node apps/web/server.js` | 1+ |

Managed dependencies: PostgreSQL 15+ and Redis 7+ (with persistence, `maxmemory-policy noeviction`, as
BullMQ requires).

> The Dockerfiles and `docker-compose.yml` were written for this repo but **have not been built on the
> author's machine** (Docker was unavailable). The CI `docker` job builds both images on every push to
> `main`; treat its first run as the verification.

## 1. Local (without Docker)

Requirements: Node 22.12+ (24 LTS recommended), pnpm 11, PostgreSQL, Redis.

```bash
pnpm install
cp .env.example .env              # set DATABASE_URL, SEED_ADMIN_PASSWORD (12+ chars), BOT_DISCLOSURE_TEXT
createdb careerconnect && createdb careerconnect_test
pnpm db:deploy                    # apply migrations (use `pnpm db:migrate` when changing the schema)
pnpm db:seed                      # admin user + fail-closed defaults + demo_ community policies
pnpm db:generate                  # generate the Prisma client (also runs in build/typecheck)

pnpm dev:api                      # http://localhost:4000  (Swagger UI at /api/docs)
pnpm dev:worker                   # background jobs
API_URL=http://localhost:4000 pnpm dev:web   # http://localhost:3000
```

Then, in the dashboard: **Policies → Run discovery now**. Drafts appear in **Review** within seconds.
Publishing starts **paused**; resume it under **System** to try simulated publication in DEMO mode.

## 2. Local (Docker Compose)

```bash
cp .env.example .env              # set SEED_ADMIN_PASSWORD and BOT_DISCLOSURE_TEXT
docker compose up --build
docker compose run --rm migrate pnpm exec prisma db seed
open http://localhost:3000
```

## 3. Production (any container host)

Works on Render, Fly.io, Railway, ECS/Fargate, Cloud Run with an always-on worker, or Kubernetes.

1. **Provision** managed Postgres and Redis on a private network with TLS.
2. **Secrets:** set every variable from `.env.example` in the host's secret store. Required in production:
   `NODE_ENV=production`, `COOKIE_SECURE=true`, `WEB_ORIGIN=https://<dashboard>`, `DATABASE_URL`,
   `REDIS_URL`, `APP_MODE`, `LLM_PROVIDER` plus its key and models, `BOT_DISCLOSURE_TEXT`, `SENTRY_DSN`.
3. **Build** images in CI. Pass `--build-arg API_URL=https://<internal api address>` to the web image,
   because Next.js bakes the `/api` proxy target in at build time.
4. **Release:**
   1. Run `migrate` to completion.
   2. Deploy `api` and `worker`.
   3. Deploy `web`.
5. **Expose** only `web` publicly. The dashboard proxies `/api/*` to the API, so the session cookie stays
   first-party. If you must expose the API too, restrict it to `/api/health` at the edge.
6. **First admin:** run `node dist/seed.js` once inside the api container (with `SEED_ADMIN_EMAIL` and
   `SEED_ADMIN_PASSWORD` set), log in, then remove `SEED_ADMIN_PASSWORD` from the environment.
7. **Health checks:** `GET /api/health` (liveness). The authenticated `GET /api/system/health` reports
   database, Redis, queue, Reddit and LLM status for the dashboard.

## 4. Mode progression (do not skip steps)

| Step | `APP_MODE` | Reddit credentials | What happens |
|------|-----------|--------------------|--------------|
| 1 | `DEMO` | none | Synthetic data only; simulated publication |
| 2 | `DRAFT_ONLY` | none | Same review workflow, publishing impossible |
| 3 | `DRAFT_ONLY` | approved, read scopes | Read-only discovery in approved communities; humans review drafts |
| 4 | `LIVE` | approved, plus every item in the [authorization checklist](reddit-authorization-checklist.md) | Publication possible only where every policy check passes. Keep `PUBLISH_MAX_*` very low at first |

Rollback at any point: **System → Pause**, or set `PUBLISHING_HARD_DISABLED=true` or `APP_MODE=DRAFT_ONLY`
and redeploy.

## 5. Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Migrate (dev, creates migrations) | `pnpm db:migrate` |
| Migrate (deploy) | `pnpm db:deploy` |
| Seed | `pnpm db:seed` |
| Typecheck | `pnpm typecheck` |
| Test (unit + integration + web) | `pnpm test` (needs Postgres; `TEST_DATABASE_URL` must name a database containing "test") |
| API unit tests only | `pnpm --filter @careerconnect/api test:unit` |
| Build | `pnpm build` |
| Regenerate OpenAPI | `pnpm --filter @careerconnect/api openapi` → `docs/openapi.json` |
| Run built API / worker | `pnpm --filter @careerconnect/api start` / `start:worker` |

# CareerConnect AI

An AI assistant for career and job discussions on Reddit. It finds relevant questions, drafts specific
and helpful replies, checks their quality, and publishes **only** when a deterministic policy engine
confirms the action is authorized. Every other case goes to human review or is skipped.

The default is safe:

- `APP_MODE=DEMO` uses synthetic data and sends nothing to Reddit.
- Publishing starts **paused**.
- Every Reddit authorization starts as **UNKNOWN**, which the engine treats as **not allowed**.

> ⚠️ **Read [docs/reddit-authorization-checklist.md](docs/reddit-authorization-checklist.md) before
> going live.** Reddit now requires explicit approval before any Data API access, and commercial use
> needs a written agreement. Third-party reports say new public API requests close on
> **2026-10-31**. Without approval, run in `DEMO` or `DRAFT_ONLY`. The app has no scraping or
> browser-automation fallback, by design.

## Quick start (local)

Requirements: Node 22.12+ (24 recommended), pnpm 11, PostgreSQL 15+, Redis 7+.

```bash
pnpm install
cp .env.example .env            # set DATABASE_URL, TEST_DATABASE_URL, SEED_ADMIN_PASSWORD, BOT_DISCLOSURE_TEXT
createdb careerconnect && createdb careerconnect_test
pnpm db:deploy && pnpm db:seed
pnpm dev:api                    # :4000, Swagger UI at http://localhost:4000/api/docs
pnpm dev:worker
pnpm dev:web                    # http://localhost:3000, log in with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
```

In the dashboard:

1. Policies → **Run discovery now**. Drafts appear under **Review**.
2. Approve a draft, then resume publishing under **System**.
3. Publish it. In DEMO mode it's a **simulated** publication to the mock provider.

Docker: `docker compose up --build` (see [docs/deployment.md](docs/deployment.md)).

```bash
pnpm typecheck   # all packages
pnpm test        # 106 API tests (unit + Postgres integration) + 24 web tests; mocked Reddit/LLM only
pnpm build
```

## How it works

```
                         ┌────────────── apps/api (Fastify) ──────────────┐
 Next.js dashboard ──/api──► routes ─► services ─► policy engine (pure)  │
 (apps/web)              │                │                              │
                         │           BullMQ (Redis)                      │
                         └────────────────┼──────────────────────────────┘
                                          ▼
                     worker: discovery → analysis → publish → maintenance
                        │           │                │
              RedditProvider    LlmProvider     RedditProvider
             (mock | live)  (mock|anthropic|openai)  (mock simulation | live)
```

1. **Discovery** (read-only) scans communities that have `discoveryEnabled`. On live Reddit it also
   requires API access *and* community authorization to be APPROVED. It stores a minimal context: title,
   an excerpt of at most 1,200 characters, and up to 3 short comments. It stores **no usernames**, and
   it deduplicates on `(dataSource, externalPostId)`.
2. **Understanding (LLM):** the main question, the poster's goal, topic, tone, relevance, sensitivity,
   eligibility, and suspected prompt injection. Irrelevant posts stop here.
3. **Generation (LLM):** the master system prompt from the spec, with brand guardrails. Brand facts
   are included only where promotion is permitted, and the model gets the openings of recent replies
   to avoid repeating itself.
4. **Evaluation (LLM):** scores for relevance, factual support, specificity, clarity, tone and
   repetition, plus flags for promotion, privacy, fabricated experience and harmful advice.
5. **Deterministic detectors:** links, calls to action, brand mentions, unverified brand claims,
   prohibited claims, fabricated anecdotes, claims to be human, personal data, and near-duplicates
   (3-shingle Jaccard). These run again after every reviewer edit.
6. **Policy engine** ([`policy/engine.ts`](apps/api/src/policy/engine.ts)) is a pure function that
   returns `SKIP`, `HOLD_FOR_REVIEW` or `ELIGIBLE_FOR_AUTOMATION` with a per-check explanation. It
   covers all 13 required checks, plus disclosure, quality, content integrity, untrusted input and mode
   checks. UNKNOWN never counts as a pass. LLM output can only make the decision stricter.
7. **Publication worker:** re-checks the full policy and upstream post availability at execution
   time. Each draft can be claimed once (atomic). Requests are idempotent through `Idempotency-Key`.
   Before retrying, the worker looks for an existing comment, so retries can't double-post. It retries
   only transient errors, with bounded backoff that honors `Retry-After`, and trips a circuit breaker
   that pauses publishing globally. Every published reply gets the automated-activity disclosure.
8. **Retention:** expired or upstream-deleted content is purged every 6 hours, and admins can purge any
   conversation on request.

### Modes

| `APP_MODE` | Data | Publishing |
|------------|------|------------|
| `DEMO` (default) | Synthetic fixtures (`demo_*` communities, labeled "Demo data" in the UI) | Simulated only, still subject to the kill switch and community policy |
| `DRAFT_ONLY` | Synthetic, or live read-only if credentials are configured | Never |
| `LIVE` | Live, read-only discovery | Only when every check passes, including the recorded platform approvals and configured rate limits |

### Roles

**VIEWER** can read everything except the audit log. **REVIEWER** can also run discovery, generate
drafts, and approve, reject or skip them. **ADMIN** can also publish, edit policies, brand settings and
platform authorization, use the kill switch, purge content and read the audit log.

## Repository layout

```
apps/api/            Fastify API + BullMQ worker
  prisma/            schema, migrations, seed
  src/policy/        deterministic engine + content detectors
  src/llm/           provider abstraction (anthropic | openai | mock), prompts, structured schemas
  src/reddit/        provider interface, live OAuth client, mock + synthetic fixtures
  src/services/      pipeline, publish, discovery, retention, state, DTOs
  src/routes/        REST endpoints (validated, role-guarded, audited)
  test/              unit + integration (real Postgres, mocked Reddit/LLM)
apps/web/            Next.js 16 dashboard (see apps/web/README.md)
packages/shared/     API contract: enums, DTO types, zod request schemas, route catalogue
docs/                deployment, Reddit authorization, security (incl. backup/recovery), cost, troubleshooting, openapi.json
```

## Documentation

- [Deployment guide](docs/deployment.md): local, Docker, production, mode progression, commands
- [Reddit authorization checklist](docs/reddit-authorization-checklist.md)
- [Security checklist](docs/security-checklist.md), including backup, recovery and incident response
- [Cost-monitoring guide](docs/cost-monitoring.md)
- [Troubleshooting](docs/troubleshooting.md)
- [OpenAPI spec](docs/openapi.json) (also served live at `/api/docs`)

## Status by phase

| Phase | Status |
|-------|--------|
| 1. Repo, auth, DB, dashboard shell | ✅ Done |
| 2. Brand profile, synthetic fixtures, topic classification | ✅ Done |
| 3. AI generation, structured outputs, quality evaluation | ✅ Done. Anthropic and OpenAI adapters use the SDKs' structured-output parsers; the offline mock provider is used in CI and demos |
| 4. Policy engine, disclosure, review queue, audit log | ✅ Done |
| 5. Authorized Reddit integration (read-only discovery) | ✅ Implemented and unit-tested against mocked HTTP. **Not exercised against real Reddit** (no approved credentials) |
| 6. Dry-run evaluation and policy testing | ✅ `DRAFT_ONLY` mode, integration tests, randomized invariant test |
| 7. Live publication | ⛔ Code path implemented and tested with a mock publisher. It **stays disabled** until the authorization checklist is complete |
| 8. Monitoring, cost controls, deployment, docs | ✅ Sentry hook, structured logs, token accounting and daily budget, Docker, CI, docs. Docker images not yet built locally (CI builds them) |

### Unresolved risks

- **Reddit access may not be obtainable.** Approval is discretionary, and new requests reportedly closed
  on 2026-10-31. Commercial terms and pricing are unknown until Reddit responds.
- **Live client untested against real Reddit.** Endpoint shapes (`/api/comment`, `/api/info`,
  `X-Ratelimit-*`) follow Reddit's documented API, but they're verified only with mocks.
- **Detectors are heuristics.** Anecdote and PII patterns will miss some phrasings. Keep human review
  on (`automationAllowed=false`) until you've reviewed real drafts.
- **Duplicate detection** compares against the 50 most recent drafts, not all history.
- **Single-region, single-worker** design. Rate accounting assumes one publish worker.
- **Docker images** haven't been built locally. The first CI run is the verification.
- **Engagement metrics** (`CampaignMetric`) have a schema and dashboard but no automated collectors,
  because Reddit engagement data access depends on your approval. Record measurements manually or add a
  collector once permitted.

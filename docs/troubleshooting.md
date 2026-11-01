# Troubleshooting

## Publishing

**"Publication not permitted (HOLD_FOR_REVIEW)" when I click Publish.** That's the policy engine working
as designed. The response and the draft page list every check with PASS, FAIL or UNKNOWN. Common causes:

| Failing check | Fix |
|---------------|-----|
| `kill_switch` | Publishing is paused (the default after install). Resume it under System |
| `mode_target` | `DRAFT_ONLY` never publishes; `DEMO` only simulates synthetic data; Reddit data requires `LIVE` |
| `api_access_authorized` / `commercial_use_approved` / `account_labeled` | Record the approvals under System → Platform authorization (only after you actually have them) |
| `community_allowlisted` / `community_rules_current` / `automation_permitted` | Review the community under Policies and click "mark reviewed". Reviews expire after `POLICY_MAX_AGE_DAYS` |
| `rate_limits` UNKNOWN | Set `PUBLISH_MAX_PER_HOUR`, `PUBLISH_MAX_PER_DAY` and `PUBLISH_MAX_PER_COMMUNITY_PER_DAY` |
| `disclosure` | Set `BOT_DISCLOSURE_TEXT` |
| `human_review` | Approve the draft first (REVIEWER), then publish (ADMIN) |
| `not_duplicate` | The draft is too similar to another reply. Edit it while approving |
| `content_integrity` | The draft claims personal experience, claims to be human, or contains a prohibited claim. Edit it |

**Publishing paused itself.** The circuit breaker trips after `PUBLISH_CIRCUIT_BREAKER_THRESHOLD`
consecutive errors, or on any 401/403 from Reddit. The pause reason is on the System page and in the
audit log (`publishing.paused` with no actor). Fix the cause (revoked token, ban, removed approval)
before resuming.

**A draft is stuck in QUEUED.** Check that the worker is running (System → Queues). If Redis was
flushed, pause and then resume to cancel stale attempts, then publish again.

## Discovery and drafting

**Discovery finds nothing.**

- DEMO and DRAFT_ONLY without credentials scan only `demo_*` communities that have
  `discoveryEnabled`.
- LIVE/DRAFT_ONLY with credentials scan only communities whose authorization is APPROVED, and only after
  API access is APPROVED.
- Check keywords and exclusions. A non-empty keyword list requires at least one match.
- Running discovery again on the same posts is a no-op (duplicates are skipped by design).

**Conversations stay DISCOVERED.** The worker isn't running, or analysis jobs are failing. See System →
Failed jobs. `LLM_NOT_CONFIGURED` means the provider's key or models are missing; `LLM_BUDGET_EXCEEDED`
means the daily token budget was hit.

**"AI recommended not replying" (HTTP 422) on Generate draft.** The model judged the post off-topic or
unanswerable. That's expected. Nothing is stored except an audit event.

**All mock drafts for one topic look the same.** The offline `mock` provider uses a small template library.
The duplicate detector will (correctly) hold or skip near-identical drafts. Use a real LLM provider for
realistic drafts.

## Infrastructure

**`P1010: User was denied access`** when running Prisma. `DATABASE_URL` / `TEST_DATABASE_URL` needs a
user name, for example `postgresql://me@localhost:5432/careerconnect_test`.

**Prisma warns about the Node version.** Prisma 7 supports Node 20.19+, 22.12+ and 24+. Use Node 24 LTS
(`.nvmrc`).

**Integration tests refuse to run.** `TEST_DATABASE_URL` must name a database containing "test". The
tests truncate every table.

**Web can't reach the API.** The `/api` proxy target is baked in at build time from `API_URL`. Rebuild
the web app with the right `API_URL`. In dev, set it before `pnpm dev:web`.

**Login works but every request returns 403 CSRF_INVALID.** Custom clients must send the `x-csrf-token`
header with the `csrfToken` value from `/api/auth/login` or `/api/auth/me`.

**Login returns 429.** The login rate limit is 10 attempts per 15 minutes per IP.

**Cookie not set in production.** `COOKIE_SECURE=true` requires HTTPS. Behind a proxy, make sure it
forwards `X-Forwarded-Proto` (`trustProxy` is enabled in production).

**Unknown jobs appear in the queues.** If Redis is shared with other apps, our keys are namespaced under
the `careerconnect:` prefix. Jobs from other prefixes aren't ours.

**Web dev uses webpack, not Turbopack.** The shared package uses `.js` import specifiers for `.ts`
files, which Turbopack doesn't resolve, so `dev` and `build` pass `--webpack`.

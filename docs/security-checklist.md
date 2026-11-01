# Security checklist

## Implemented controls

| Area | Control | Where |
|------|---------|-------|
| Authentication | Argon2id password hashes (`@node-rs/argon2`); constant-time handling of unknown emails | `apps/api/src/auth/auth.ts` |
| Sessions | Opaque 256-bit tokens; only the SHA-256 hash is stored; `HttpOnly`, `SameSite=Strict`, `Secure` (required in production); expiry `SESSION_TTL_HOURS`; server-side logout | `auth.ts`, `routes/auth.ts` |
| CSRF | Per-session token required in the `x-csrf-token` header on every POST/PUT/PATCH/DELETE (on top of SameSite=Strict) | `requireRole()` |
| RBAC | VIEWER < REVIEWER < ADMIN, checked on every route. Publishing, policies, brand, platform authorization, kill switch and audit are ADMIN only | `routes/*` |
| Rate limiting | 300 req/min per IP globally; login 10 per 15 min; generate-draft, discovery and publish have their own limits | `app.ts`, routes |
| Input validation | Zod schemas on every body, query and param (`fastify-type-provider-zod`); 256 KB body limit | `packages/shared/src/api.ts` |
| Output safety | The dashboard renders Reddit text as plain text only (no `dangerouslySetInnerHTML`, no auto-linking); `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`; Helmet on the API | `apps/web/next.config.ts`, `app.ts` |
| Prompt injection | Reddit content is fenced in `<untrusted_reddit_content>` with delimiter stripping; heuristic and LLM injection flags force human review; the LLM has no tools and no secrets in context; the policy engine ignores LLM "permissions" | `llm/prompts.ts`, `policy/detectors.ts` |
| Secrets | Environment variables only; `.env` is git- and docker-ignored; `.env.example` holds no secrets | root |
| Logging | Pino redacts cookies, auth headers, CSRF tokens, passwords, OAuth tokens, API keys, reply bodies and Reddit context. Failed logins log a hashed email | `lib/logger.ts`, `routes/auth.ts` |
| Audit | Append-only `AuditEvent` for logins, configuration changes (with mandatory reason), draft decisions, every publish request, block, success and failure, pauses and resumes, purges | `lib/audit.ts` |
| Kill switch | DB flag (default **paused**) plus the `PUBLISHING_HARD_DISABLED` env override. Pausing removes queued jobs and cancels pending attempts. The worker re-checks the switch before every submission | `services/publish.ts` |
| Circuit breaker | Automatic pause after `PUBLISH_CIRCUIT_BREAKER_THRESHOLD` consecutive errors, or immediately on 401/403 from Reddit | `recordPublishError()` |
| Least privilege | Reddit scopes limited to `read submit identity history`; containers run as `node`; the DB user needs only DML on its own schema (migrations run as a separate job) | Dockerfiles, docs |
| Data minimization | Stores titles, excerpts truncated to 1,200 characters and up to 3 comments of 400 characters; **no usernames**; purged after `RETENTION_DAYS` | `services/discovery.ts`, `services/retention.ts` |
| Error tracking | Sentry with `sendDefaultPii: false`; internal errors return a generic message | `bootstrap.ts`, `app.ts` |

## Deployment checklist

- [ ] HTTPS everywhere; `COOKIE_SECURE=true` (the app refuses to start in production without it)
- [ ] `WEB_ORIGIN` set to the exact dashboard origin
- [ ] Postgres and Redis on private networks, TLS enabled, strong unique passwords
- [ ] Separate DB roles: `migrator` (DDL) for the migrate job, `app` (DML only) for the API and worker
- [ ] Secrets in the platform's secret manager; rotate Reddit, LLM and DB credentials at least every 90 days and immediately after staff changes
- [ ] Remove or disable the seed admin after creating named admin accounts; enforce long passwords
- [ ] Sentry DSN configured; alerts on 5xx rate, failed jobs and automatic pauses
- [ ] Dependency updates: `pnpm audit` / Dependabot weekly; lockfile committed
- [ ] Retention period matches your Reddit approval terms

## Backup and recovery

**PostgreSQL** holds all durable state: policies, drafts, the audit log and publish attempts.

- Use the managed provider's automated daily backups with point-in-time recovery (minimum 7 days).
- Encrypt backups. Restrict restore permissions to operators.
- Backups contain Reddit-derived excerpts. Keep backup retention no longer than `RETENTION_DAYS` plus
  the PITR window, or purge after restore (see below).
- **Restore drill (quarterly):** restore to a staging instance → run `pnpm db:deploy` → start the API
  with `APP_MODE=DRAFT_ONLY` → confirm the dashboard loads and audit history is intact.
- After a restore, **keep publishing paused** until you've checked for attempts that may have reached
  Reddit after the backup point. The worker's duplicate guard (`findOwnComment`) prevents double posts
  for attempts it retries, but review `PublishAttempt` rows in `PENDING`/`FAILED_TRANSIENT` by hand.
- After restoring an older backup, run the retention job (`purgeExpired`), which restarts the worker,
  so expired content is removed again.

**Redis** holds only queues. Losing it loses queued jobs but no records:

- Pending `PublishAttempt` rows stay `PENDING`. Pause, then resume, to cancel them cleanly, or
  re-request publication.
- Conversations stuck in `DISCOVERED` can be re-analyzed by running discovery again (it skips
  duplicates) or from the conversation page.

## Incident response (quick reference)

1. **Stop:** System → Pause (or set `PUBLISHING_HARD_DISABLED=true` and redeploy).
2. **Assess:** filter Audit by `publish.*`; check PublishAttempt history on the affected drafts.
3. **Remediate:** delete problematic comments on Reddit by hand from the bot account; update community
   policies (`automationAllowed=false`) with a reason.
4. **Record:** write a resume reason that references the incident review. Resuming never overrides
   missing authorization.

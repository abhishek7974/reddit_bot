# @careerconnect/web

Next.js 16 (App Router) dashboard for CareerConnect AI: review AI-drafted replies, manage community policies,
brand settings, discovery, the global kill switch and audit trail. All data comes from `apps/api`; types come from
`@careerconnect/shared`.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm --filter @careerconnect/web dev` | Dev server on http://localhost:3000 (webpack) |
| `pnpm --filter @careerconnect/web build` | Production build (`output: 'standalone'`); does not need the API running |
| `pnpm --filter @careerconnect/web start` | Serve the build locally with `next start` on port 3000 |
| `pnpm --filter @careerconnect/web typecheck` | `next typegen && tsc --noEmit` (`lint` is the same) |
| `pnpm --filter @careerconnect/web test` | Vitest + Testing Library (jsdom) |

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_URL` | `http://localhost:4000` | Origin of the Fastify API. `next.config.ts` rewrites `/api/:path*` to `${API_URL}/api/:path*` so the httpOnly session cookie stays same-origin. |

**`API_URL` is read when the build runs:** Next writes rewrites into `.next/routes-manifest.json`, so set it during
`next build` (for example as a Docker build arg), not only when the server starts.

## Docker / standalone

`next build` writes `.next/standalone/` (a monorepo layout: the server lives at `apps/web/server.js`). Copy
`.next/static` to `.next/standalone/apps/web/.next/static`, then run `node apps/web/server.js` with `PORT` and `HOSTNAME`
set. There is no `public/` directory.

## Why webpack (`--webpack`)

`@careerconnect/shared` ships raw TypeScript and imports its own files with `./enums.js`-style specifiers. Turbopack
can't map `.js` to `.ts` there, so `dev` and `build` use webpack with `experimental.extensionAlias`
(`.js → .ts/.tsx/.js`) and `transpilePackages: ['@careerconnect/shared']`.

## Structure

```
src/
  app/
    layout.tsx, globals.css        root layout + Tailwind v4
    login/page.tsx                 public sign-in
    (dashboard)/layout.tsx         SessionProvider + AppShell (everything behind login)
    (dashboard)/page.tsx           Overview (DashboardSummary)
    (dashboard)/conversations/     Explorer + [id] detail (generate draft, purge)
    (dashboard)/drafts/            Review queue + [id] Reply Review (approve / reject / skip / publish)
    (dashboard)/brand/             Brand profile editor
    (dashboard)/policies/          Community policies + discovery settings + run discovery
    (dashboard)/analytics/         Metrics charts, breakdowns, engagement
    (dashboard)/system/            Health, queues, platform authorization, kill switch
    (dashboard)/audit/             Admin audit log
  components/                      UI kit, AppShell, ModeBanner, Dialog (Radix), ListEditor, BarChart, ...
  lib/
    api.ts                         typed fetch client (CSRF header, ApiClientError, 401 hook)
    session.tsx                    session + publishing-state context, role checks
    hooks.ts                       useApi (GET) / useAction (mutations + aria-live message)
    format.ts, roles.ts, diff.ts, redirect.ts, validation.ts
```

## Conventions

- Mutating requests send `x-csrf-token` (`CSRF_HEADER`) with the token from login or `GET /api/auth/me`.
- A 401 response redirects to `/login?next=…` (open redirects are blocked). A 403 response shows an "insufficient role" message.
- Reddit and LLM text is untrusted. It renders as plain React text only, with no `dangerouslySetInnerHTML` and no
  auto-linking. Permalinks become links only when they are `https://*.reddit.com`, and they open with `rel="noopener noreferrer"`.
- Forms check input with the shared zod schemas (`updatePolicyBody`, `discoverySettingsBody`, …) before sending it.
- Publishing sends an `Idempotency-Key` (`crypto.randomUUID()`), one key per publish intent.

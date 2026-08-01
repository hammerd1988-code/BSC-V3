# BSC-V3 Architecture Review — Verification & Remediation Plan

Verified against `main` @ `8e12a33`. Baseline: `tsc --noEmit` clean, 16 test files / 70 tests passing.

## Verdicts

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | 4 duplicated server entrypoints | **Confirmed** | `server.ts` (10 routes), `server.prod.ts` (9), `server.unified.ts` (19). `railway.json` + `nixpacks.toml` both start `start:unified`, so `server.unified.ts` is the deployed one. `serverAi.ts` is a shared module, not a 4th entrypoint — the review miscounted there. |
| 2 | Hardcoded admin email | **Confirmed, and worse than described** | `src/AuthContext.tsx:43,115`, and server-side in `supabase/migrations/0007_user_profile_trigger.sql:89`. The email itself is cosmetic; the real hole is that the `users self-update` policy (`0001_init.sql:285`) lets any account update **every** column of its own row, `role` included — one PostgREST call away from self-granting admin. |
| 3 | `dev-secret-key` webhook fallback | **Confirmed** | `server.ts:103`, `server.prod.ts:113`, `server.unified.ts:144`. Warns then accepts. |
| 4 | CORS can silently become `false` in prod | **Confirmed** | `server.ts:58`, `server.prod.ts:57`, `server.unified.ts:81`. Health endpoint reports `socketCorsConfigured`, but the process still boots. |
| 5 | In-memory state blocks horizontal scaling | **Confirmed** | Also applies to the rate limiter added in Phase 1: `createRateLimiter` keeps its hit counters in a process-local `Map`, so N instances mean N× the intended quota. Acceptable only because the server is already single-instance. `liveStreams`/`userToStream`/`connectedUsers`/`workspaceStates` in each server; `machines`/`directives`/`deviceAuths`/`fileTransfers` in `casperRelay.ts`. Single-instance only. |
| 6 | `casperControlCenter.ts` too large | **Confirmed** | 135 KB / 2954 lines. |
| 7 | `botMayhemAutonomy.ts` too large | **Confirmed** | 74 KB / 1806 lines. |
| 8 | Schema denormalization | **Confirmed** | `users.id text` + `auth_uid uuid`; `users.friends text[]` (28 references in `src/`) alongside `0003_follows.sql`; `users.blocked_users text[]`; `posts.likes` counter + `post_likes` join table; `transmissions.unread_counts jsonb`. |
| 9 | "Any authed user can update/delete any comment" | **Wrong — but a real, different bug** | Postgres RLS is deny-by-default: with no `update`/`delete` policy, those operations are **blocked**, not open. The actual defect is migration drift: `0004`/`0005` `alter` policies named `comments_delete_owner` and `comments_insert_self` that **no migration ever creates**. They exist only in the live DB. A fresh `db reset` produces a different schema than production. |
| 10 | No rate limiting on REST endpoints | **Confirmed** | Only `casperRelay.ts` device-init (10/min/IP). No `express-rate-limit` dependency. AI/TTS/command endpoints unprotected. |
| 11 | Hardcoded Square access token | **Confirmed — requires rotation** | `server.unified.ts:163`. Present in git history since `a049c5f`; deleting it from `HEAD` does not un-leak it. |
| 12 | No CSRF protection | **Confirmed, low severity** | Auth is `Authorization: Bearer`, not cookies, so there is no ambient-credential vector today. |
| 13 | "What's good" list | **Confirmed** | `tsc --noEmit` exits 0; `vitest run` = 16 files / 70 tests green. |
| 14 | No ESLint/Prettier, no CI gate, `console.*` logging | **Confirmed** | `lint` is `tsc --noEmit`; no eslint/prettier/husky config; `.github/workflows` has only 3 release workflows and no test/lint gate; 529 `console.*` call sites. |

## Findings the review missed

- **A. Unauthenticated Casper memory endpoints (IDOR).** `server.ts:126,141` and `server.prod.ts:143,158` expose `GET/POST /api/casper/memory` with **no auth**, taking `userId` straight from the query string / body — any caller can read or poison any user's Casper memories. `server.unified.ts` gates the same routes with `requireCasperAuth`. Latent today because Railway runs `unified`, but `npm run start:prod` would ship it. This is the single most concrete illustration of why finding #1 matters.
- **A2. Self-service privilege escalation.** `create policy "users self-update" on public.users for update using (auth.uid() = auth_uid)` (`0001_init.sql:285`) is row-scoped but not column-scoped, and RLS cannot express column restrictions. Any signed-in user could `PATCH /rest/v1/users?id=eq.<self>` with `{"role":"admin"}` and unlock every `AdminRoute` and every server check that reads `users.role`. Fixed by `0060_prevent_role_self_escalation.sql`.
- **B. `colosseumRoutes.ts` is 93 KB / 2098 lines** — second-largest file in the repo, and not mentioned in the review.
- **C. No pre-commit hooks** — nothing prevents committing a broken typecheck or a secret.

## Remediation plan

### Phase 1 — Security & fail-fast — **done** (this PR)
1. ✅ Square token/location fallbacks deleted; `createSquareClient()` throws when unset. **Still requires rotating the leaked token in the Square dashboard** — code changes alone are insufficient.
2. ✅ `dev-secret-key` removed; production 500s without `AGENT_WEBHOOK_SECRET`, development mints a random per-process key (`serverSecurity.ts`).
3. ✅ `assertProductionConfig` throws at boot when no CORS origin is configured.
4. ✅ `requireCasperAuth` on the memory endpoints in `server.ts` / `server.prod.ts`, with the target id derived from the session for non-admins.
5. ✅ Rate limiting on AI generation/vision, TTS, transcription, Casper directives, sub-agent spawn, browser actions, terminal execution, and payments.
6. ✅ `0059_comments_owner_policies.sql` creates the owner-scoped comment policies idempotently; `0005`/`0006` `alter policy` statements guarded so a fresh `db reset` reaches it.
7. ✅ `0060_prevent_role_self_escalation.sql` pins `users.role` against self-service escalation; client-side role promotion removed from `AuthContext`.
8. ✅ `.github/workflows/ci.yml` — typecheck + tests + build on every PR.

### Phase 2 — Consolidate entrypoints — **done**
One runtime module: `server.ts`. `server.prod.ts` and `server.unified.ts` are deleted, and the environment difference they encoded is now an `isProd` branch — Vite middleware (dynamically imported, since `vite` is a devDependency) in development, `dist/` static serving in production. The formerly triplicated speech routes (`/api/tts`, `/api/tts/mimo`, `/api/tts/voices`, `/api/transcribe`) moved to `speechRoutes.ts`. `npm start`, `npm run dev:full`, `railway.json`, and `nixpacks.toml` all point at the one file.

### Phase 3 — Structure & hygiene
Split `casperControlCenter.ts`, `colosseumRoutes.ts`, and `botMayhemAutonomy.ts`; add ESLint + Prettier; add a CI workflow running typecheck + tests on PRs; add pre-commit hooks; replace `console.*` with a structured logger; document the single-instance constraint (including the process-local rate limiter) or move quota enforcement to a shared store / gateway.

### Deferred
Redis-backed shared state; migrating `friends` / `blocked_users` to join tables; error tracking (Sentry).

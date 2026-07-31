# BSC-V3 Architecture Review — Verification & Remediation Plan

Verified against `main` @ `8e12a33`. Baseline: `tsc --noEmit` clean, 16 test files / 70 tests passing.

## Verdicts

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | 4 duplicated server entrypoints | **Confirmed** | `server.ts` (10 routes), `server.prod.ts` (9), `server.unified.ts` (19). `railway.json` + `nixpacks.toml` both start `start:unified`, so `server.unified.ts` is the deployed one. `serverAi.ts` is a shared module, not a 4th entrypoint — the review miscounted there. |
| 2 | Hardcoded admin email | **Confirmed, plus more** | `src/AuthContext.tsx:43,115`. Also hardcoded server-side in `supabase/migrations/0007_user_profile_trigger.sql:89`. The DB trigger means the role *is* enforced server-side, so it is not a privilege-escalation hole — but it is unmaintainable and re-asserted on every login. |
| 3 | `dev-secret-key` webhook fallback | **Confirmed** | `server.ts:103`, `server.prod.ts:113`, `server.unified.ts:144`. Warns then accepts. |
| 4 | CORS can silently become `false` in prod | **Confirmed** | `server.ts:58`, `server.prod.ts:57`, `server.unified.ts:81`. Health endpoint reports `socketCorsConfigured`, but the process still boots. |
| 5 | In-memory state blocks horizontal scaling | **Confirmed** | `liveStreams`/`userToStream`/`connectedUsers`/`workspaceStates` in each server; `machines`/`directives`/`deviceAuths`/`fileTransfers` in `casperRelay.ts`. Single-instance only. |
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
- **B. `colosseumRoutes.ts` is 93 KB / 2098 lines** — second-largest file in the repo, and not mentioned in the review.
- **C. No pre-commit hooks** — nothing prevents committing a broken typecheck or a secret.

## Remediation plan

### Phase 1 — Security & fail-fast (immediate)
1. Delete the Square token fallback; 500 when `SQUARE_ACCESS_TOKEN` is unset. **Rotate the leaked token in the Square dashboard** — code changes alone are insufficient.
2. Reject webhooks in production when `AGENT_WEBHOOK_SECRET` is unset, instead of falling back to `dev-secret-key`.
3. Fail fast at boot in production when no CORS origin is configured.
4. Add `requireCasperAuth` to the memory endpoints in `server.ts` / `server.prod.ts`, and derive `userId` from the session rather than the request.
5. Add rate limiting to AI generation, TTS, transcription, and command/terminal endpoints.
6. Add a migration that creates the missing `comments_update_owner` / `comments_delete_owner` / `comments_insert_self` policies idempotently, so migrations match production.

### Phase 2 — Consolidate entrypoints
Reduce to one runtime server module with environment-based branching (Vite middleware conditionally imported for dev). Keep thin `server.ts` / `server.prod.ts` shims or drop them entirely once `package.json` scripts point at the single module.

### Phase 3 — Structure & hygiene
Split `casperControlCenter.ts`, `colosseumRoutes.ts`, and `botMayhemAutonomy.ts`; add ESLint + Prettier; add a CI workflow running typecheck + tests on PRs; add pre-commit hooks; replace `console.*` with a structured logger; document the single-instance constraint.

### Deferred
Redis-backed shared state; migrating `friends` / `blocked_users` to join tables; error tracking (Sentry).

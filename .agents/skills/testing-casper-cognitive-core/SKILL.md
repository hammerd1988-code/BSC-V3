---
name: testing-casper-cognitive-core
description: Test the Casper Cognitive Core (AI Core Settings) modal — LLM endpoint/model/temperature/system-prompt and the Max Tool Rounds field — verifying round-trip persistence to users.ai_settings. Use when verifying changes to the Casper settings modal or ai_settings columns.
---

# Testing Casper Cognitive Core (AI Core Settings)

## Overview
The Cognitive Core modal lets a user override Casper's LLM config per account. It lives
in `src/components/Casper.tsx` and saves to the Supabase `users.ai_settings` JSON column.
Fields: provider preset, custom model id, API key (masked), base URL, temperature,
system prompt override, and **Max Tool Rounds** (PR #213).

## Devin Secrets Needed
- `SUPABASE_SERVICE_ROLE_KEY` — admin magic-link auth + DB verification queries.
- `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`) — for `/auth/v1/verify`.

## Architecture / UI path
- Route `/casper` (App.tsx). The Supabase client has hardcoded prod defaults, so plain
  `npm run dev` (Vite, port 3000) works for this modal — the save is a **client-side
  Supabase call**, no Express API needed.
- Gear icon in the header (top-right, after the globe/ghost-browser icon) toggles the
  modal: `setShowAiCore(!showAiCore)`.
- "Max Tool Rounds (Optional)" is a `type=number` input (`min=1 max=60`, placeholder
  "Default (25)") near the bottom, above Cancel / Save AI Core.
- Save (`saveAiCore`) clamps rounds to [1,60]; **blank/<1 deletes** `maxToolRounds` (and
  legacy `max_tool_rounds`) so the server default (25) applies. Reopen reads back via
  `initialCasperCore`.

## Auth: inject an admin session (most reliable method)
Email/password does NOT work for hammerd1988@gmail.com. Use the service-role magic-link
flow (`mint-session.cjs` pattern): `generate_link` → grab `hashed_token` →
`/auth/v1/verify` with **`token_hash`** (NOT `token`, else 403 otp_expired) → store
`{access_token, refresh_token, expires_at, ...}` under localStorage key
`sb-<project-ref>-auth-token` (ref `kxfhxrdrlvnvtzdeuvwb`).

**Robust injection (avoids two real gotchas):**
- The Chrome address bar (`computer` tool) mangles `http://...` URLs into Google
  searches, and `window.location.href='/relative'` resolves against `chrome://new-tab-page`
  if the tab is on the new-tab page. Always navigate with a full `http://localhost:3000/...`.
- `browser_console` with `async`/`await` or `fetch`/sync-XHR of a multi-KB body
  intermittently fails with "CDP evaluation failed". Short **synchronous** snippets work.

The workaround that reliably worked: write the session to `public/ls-inject.json`
(`{key, value}`) and a tiny `public/devlogin.html` that does a **synchronous** XHR for it,
`localStorage.setItem`, then `window.location.href='/casper'`. Navigate to
`http://localhost:3000/devlogin.html` via `window.location.href` (absolute). This needs no
CDP logic and survives the flakiness. **Delete both files from `public/` afterward.**

## Tests (Max Tool Rounds round-trip)
Capture baseline first: `GET users?id=eq.<uid>&select=ai_settings` with service-role;
confirm whether `maxToolRounds` is present.
1. **Set non-default**: type `40`, Save. PASS = DB `ai_settings.maxToolRounds === 40`
   (a **number**, not string/25/absent).
2. **Round-trip**: F5 reload, reopen modal. PASS = field shows `40`.
3. **Clear**: empty the field, Save. PASS = `maxToolRounds` key **absent** in DB
   (server falls back to 25). This also restores baseline.

## Evidence
- Annotated recording (test_start + one consolidated assertion per test).
- Service-role JSON of `ai_settings` before/after each save (text evidence).
- Screenshots: field=40, reloaded field=40, field blank.

## Common Issues
- If the field reads back blank after a save that should have persisted, suspect the
  camelCase/snake_case mismatch (`maxToolRounds` vs `max_tool_rounds`) in read/write.
- A value saved as a string (e.g. `"40"`) instead of a number would indicate the
  `Number()` coercion in the change/save handler regressed.
- Dev server can die on VM restart — re-run `npm run dev` and confirm port 3000 before
  re-injecting the session (the session token itself may still be valid).

## Deployment
Production deploys via **Railway**, not Vercel. Vercel CI red is a known pre-existing
failure and does not block this repo.

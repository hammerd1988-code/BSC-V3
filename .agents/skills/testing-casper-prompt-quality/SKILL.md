---
name: testing-casper-prompt-quality
description: Verify Casper's system-prompt behavior (engineering depth + personality/emotional adaptivity) end-to-end across chat surfaces. Use when changing casperControlCenter.ts prompt modules, Casper.tsx CASPER_SYSTEM_PROMPT, or any Casper persona/prompt text.
---

# Testing Casper Prompt Quality (Engineering Depth + Persona)

## Overview
All Casper chat surfaces route through the base system prompt composed in
`src/lib/casperControlCenter.ts` (engineeringExcellenceModule + personalityModule +
surface persona + memory). The frontend fallback prompt lives in
`src/components/Casper.tsx` (`CASPER_SYSTEM_PROMPT`); other fallbacks in `serverAi.ts`,
`src/components/Transmissions.tsx`, `src/lib/botPersonas.ts`.

## Devin Secrets Needed
- `SUPABASE_SERVICE_ROLE_KEY` — mint admin magic-link session.
- `VITE_SUPABASE_ANON_KEY` — for `/auth/v1/verify` (`token_hash`, NOT `token`).
- Server LLM key (`OPENAI_API_KEY` or configured custom core) must be present in `.env`
  or Casper returns fallback text.

## Setup
- `npm run dev:full` → localhost:3001 (Express + Vite one port). Strip quotes when
  loading `.env` values into env vars in PowerShell, or SUPABASE_URL validation fails.
- Auth: magic-link session injected into localStorage
  (`sb-kxfhxrdrlvnvtzdeuvwb-auth-token`) as documented in
  `testing-casper-cognitive-core` skill.

## Surfaces to exercise
1. **Casper Control Center** (`/casper`) — main chat textarea "Whisper to Casper...".
2. **Ask Casper floating widget** — open via the bottom-nav avatar "More menu" →
   "Ask Casper" (it is NOT a standalone floating button; the ghost icon in the nav
   navigates to /casper instead). Component: `src/components/AskCasperWidget.tsx`.

## Test pattern (prompt-quality assertions for a stochastic LLM)
Assert on the *presence of concrete specifics the prompt mandates*, not exact wording:
- **Engineering depth**: ask a debugging question (e.g. React re-render storm) — PASS if
  reply names real tools/APIs (DevTools Profiler, React.memo, state colocation,
  useDeferredValue) with code and tradeoffs; FAIL if generic advice or "As an AI".
- **Architecture depth**: ask a scale design question (e.g. Postgres schema for 50M
  rows) — PASS if concrete indexes (composite (conversation_id, created_at)),
  partitioning, and tradeoff discussion appear.
- **Persona/emotional adaptivity**: send a frustrated message — PASS if Casper grounds
  the emotion calmly in-character and offers concrete help; FAIL if sterile/corporate.

## Gotchas
- Chat responses render markdown as one long bubble; scroll within the chat pane to
  screenshot the full response, and screenshot progressively as it streams.
- The Chrome address bar may autocomplete `localhost:3001/` to a previously visited
  deep route (e.g. /casper); press Delete after typing to dismiss autocomplete.
- Route transitions to the home feed can take 20s+ on first load (Vite cold compile of
  feed chunks); be patient before assuming a hang.
- Casper memory persists conversation across reloads ("Restored N messages"); use the
  trash icon to start a clean conversation if prior context could contaminate a test.
- The browser (Chrome for Testing) may crash under memory pressure during long
  sessions; relaunch `C:\devin\chrome\chrome-win64\chrome.exe` with
  `--remote-debugging-port=29229 --user-data-dir=C:\Users\Administrator\.browser_data_dir`
  and the login session survives.

## Deployment
Production deploys via **Railway**, not Vercel.

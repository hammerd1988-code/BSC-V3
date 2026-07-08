---
name: testing-botforge-district
description: Test the Bot Forge District page (/colosseum/forge) end-to-end — persona picker loading and page scrolling/tab switching. Use when verifying BotForge.tsx UI or gladiator-roster changes.
---

# Testing Bot Forge District (`/colosseum/forge`)

Route: `http://localhost:3001/colosseum/forge` (admin only — gated by `AdminRoute`, needs `hammerd1988@gmail.com`).
Component under test: `src/components/BotForge.tsx`. Backend roster: `gladiators` table.

## Setup
1. Start the full stack: `npm run dev:full` (Express + Vite on port **3001**; port 3000 does NOT serve API routes).
2. Auth as admin via magic-link injection (see the knowledge note "When testing or authenticating on the BSC-V3 app"). Scripts used in past sessions: `mint-session.cjs` (mints `sb-session.json`) + a Playwright injector that writes `localStorage['sb-<ref>-auth-token']` via CDP at `http://localhost:29229`, then navigates to `/colosseum/forge`.

### Gotcha: two Chrome windows / login-vs-authed mismatch
If the visible screenshot shows the **login** screen but `read_dom` shows the **authed** forge page (or vice-versa), there are two Chrome windows stacked — the CDP-controlled authed window is behind a stray login window. Fix: click the other Chrome icon in the taskbar to raise the authed window. `page.bringToFront()` only raises the tab within its own window, not the OS window. Prefer NOT launching extra Chrome windows; reuse the CDP-controlled one.

## What to verify

### Test 1 — Persona picker loads all gladiators
- The label reads **"Select a Gladiator to Configure (N available)"**. It should be the full platform roster (was ~105), NOT `1`/only Sapphire.
- Opening the dropdown lists many distinct bots.
- **Root cause of the old "only Sapphire" bug:** the roster query used `.select('*')` on `gladiators`, which has column-level RLS on `api_key` → `42501 permission denied` for the authenticated role → 0 rows → fell back to a slow per-bot ensure endpoint where only Sapphire completed in time. Fix = select an explicit safe column list (`GLADIATOR_SELECT` constant). If the picker regresses to 1/Sapphire, suspect a new `.select('*')` on `gladiators` (there were 3 such call sites: roster load, CRED-convert refresh, and one other). Verify quickly with REST: `GET /rest/v1/gladiators?select=*` → 42501; `GET …?select=id,name` → returns all rows.

### Test 2 — Page scrolls + config tabs switchable
- Mouse-wheel scroll must move the page; the header must scroll away (not stay pinned covering the viewport).
- The tab bar (Personality / Battle Strategy / Autonomy / Spar Mode / Analytics) must be reachable; clicking a tab swaps content (Battle Strategy → "Fighting Style"; Autonomy → "Operating Mode") and moves the active-tab highlight.
- **Root cause of the old "unscrollable" bug:** the mega-header was `sticky top-0 z-30` and ~498px tall; combined with `#root { overflow-x: clip }`, scroll was trapped. Fix = make the header non-sticky (`relative overflow-hidden …`). If scrolling breaks again, check for a re-introduced `sticky`/`fixed` on the header.

## Evidence
Record one continuous walkthrough: read the "(N available)" label → open dropdown → scroll down → click Battle Strategy → click Autonomy. Annotate test_start + assertion for each. Capture at least one screenshot of the "(N available)" count and one of a switched tab.

## Devin Secrets Needed
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (for magic-link `admin.generateLink`).

## Notes
- CI: Vercel is expected red ("account blocked") — deployment is on **Railway**. Not a regression.
- Typecheck: `npx tsc --noEmit` — `packages/desktop/electron/*` errors (missing `electron` modules) are pre-existing and unrelated to `src/`.

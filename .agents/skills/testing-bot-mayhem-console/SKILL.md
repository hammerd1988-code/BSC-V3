---
name: testing-bot-mayhem-console
description: Runtime-test the Bot Mayhem admin console (/bots/mayhem) and server-side AI generation — roster/playbooks/runs tabs, Spark Feed / React / Battle triggers, bot post inserts, and run error strings. Use when verifying botMayhemAutonomy.ts, BotMayhemConsole.tsx, serverAi.ts model defaults, or colosseumRoutes.ts model routing.
---

# Testing the Bot Mayhem console (`/bots/mayhem`) and server AI defaults

Component: `src/components/BotMayhemConsole.tsx`. Server: `botMayhemAutonomy.ts` (routes
`/api/bot-mayhem/{roster,playbooks,runs,maga-switches,execute,trigger-faction-post,trigger-reaction,trigger-battle}`),
`serverAi.ts` (provider fan-out), `colosseumRoutes.ts` (gladiator/bot model resolution).

## Devin Secrets Needed
- `OPENAI_API_KEY` — the only AI provider usually provisioned. Without `GEMINI_API_KEY`,
  OpenRouter or Fireworks keys, those branches are unreachable; say so instead of guessing.
- `SUPABASE_SERVICE_ROLE_KEY` — magic-link admin auth + DB verification.
- `SUPABASE_PERISHABLE_KEY` — this holds the *working* publishable key. The legacy
  `SUPABASE_ANON_KEY` value returns 401 "Invalid API key" on project `kxfhxrdrlvnvtzdeuvwb`;
  export `VITE_SUPABASE_ANON_KEY` from `SUPABASE_PERISHABLE_KEY` instead.

## Setup
1. `npm run dev:full` → Express + Vite on **port 3001**. `npm run dev` (3000) serves no API
   routes, so nothing in Bot Mayhem works there.
2. Admin auth: service-role magic-link (`generate_link` → `hashed_token` → `/auth/v1/verify`
   with **`token_hash`**) → localStorage `sb-kxfhxrdrlvnvtzdeuvwb-auth-token`. Admin routes
   gate on `currentUser.role === 'admin'`. Delete any temp session/injection files from
   `public/` and the home dir afterward — never leave them in the repo.
3. Chrome's address bar via the `computer` tool often mangles URLs (drops `_`, ignores Enter).
   Type `localhost`, press `shift+semicolon` for `:`, then `3001/<path>`, and verify the
   resulting URL in the screenshot. In-app nav links are more reliable than the omnibox.

## High-signal tests
1. **Console loads**: ROSTER shows ~11 bots / 6 factions, PLAYBOOKS and RUNS load without a
   "load failed" line. `MAGA switches load failed` is EXPECTED unless migration
   `0058_bot_mayhem_maga_switches.sql` has been applied to the target project — not a bug.
2. **Post creation**: ROSTER → pick a bot → ACTIONS → Spark Feed → AI prompt + tag → Run post.
   PASS = console log `post complete — 0 errors, 1 results`, a `post` run `completed` in RUNS,
   and a new row in `posts` (verify with service-role:
   `GET /rest/v1/posts?author_id=eq.<botUserId>&select=*&order=created_at.desc`).
   Note `posts` has **no** `shares_count` and **no** `tags` column — tags live in
   `neural_tags`. An insert listing a non-existent column fails every bot post with
   `Could not find the '<col>' column of 'posts' in the schema cache`.
3. **Error detail**: the header REACT button is the fastest way to force an AI failure path.
   A good failure reads `No comment generated: <provider error>`; a bare
   `No comment generated` means the failure-propagation regressed.
4. **Content vs fallback (easy to miss)**: a "successful" run does NOT prove AI worked —
   `postContentForBot` falls back to `"<BOT> stands with <FACTION>. <motto>"` when
   generation returns empty. Always read the stored `content`, and grep the server log for
   `[serverAi] All providers failed` / `[BotMayhem] AI generation empty`.

## Model-default gotcha (check this on any model bump)
OpenAI's GPT-5.x family and the o-series reject `max_tokens`:
`400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.`
`src/lib/modelParams.ts` (`maxTokensParam(model, limit, baseUrl)`) picks the right parameter
and is spread into the request bodies in `serverAi.ts`, `colosseumRoutes.ts` and
`src/lib/ai.ts`; `packages/casper-cli/src/llm/client.ts` keeps its own copy of the rule.
A new model family that isn't covered by that regex silently empties every server generation
while runs still report "completed". Quick A/B before UI testing:
```
POST https://api.openai.com/v1/chat/completions {model:<new default>, max_tokens:20, ...}
POST … {model:<old default>, max_tokens:20, ...}
```
If the new default 400s and the old one 200s, the model bump needs a
`max_completion_tokens` switch. The same check applies to any future model family
(e.g. models that also drop `temperature`).

## Casper chat caveat
`users.ai_settings` (Casper → gear → AI Core Settings) overrides the platform default for
that account. The primary admin account has a custom core (a Fireworks model + Fireworks base
URL) which can return provider 500s — a Casper failure there says nothing about the platform
default. Do **not** overwrite the user's saved key/model to test the default path; exercise
the platform default through Bot Mayhem or Colosseum instead, and report the account-level
config as a separate observation.

## Known pre-existing noise (don't report as regressions)
- `faction_members ... violates foreign key constraint "faction_members_faction_id_fkey"`.
- Duplicate faction slug warnings on seed.
- `/profile/<bot_username>` renders "Neural Link Severed" (underscore stripped from route) —
  verify bot posts in the DB or feed instead of a bot profile page.

## Deployment
Production deploys via **Railway**. A red Vercel check ("Account is blocked") is expected
and unrelated.

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Blood Sweat Code

Neural-link social / streaming / bounty app. Migrated from Firebase (Firestore + Auth + Storage) to **Supabase** (Postgres + Auth + Storage + Realtime).

View the original AI Studio app: https://ai.studio/apps/8b4535cd-ac06-4134-b563-47ea1678cce7

## Run Locally

**Prerequisites:** Node.js 20+, the Supabase CLI (`npm i -g supabase`), and a Supabase project.

1. Install dependencies: `npm install`
2. Copy env: `cp .env.example .env.local` and fill in:
   - `VITE_SUPABASE_URL` — `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` — project anon public key
   - `SUPABASE_DB_URL` — full Postgres connection string (use Session Pooler if IPv4-only)
   - `GEMINI_API_KEY` — Gemini API key
3. Apply the schema: `npm run db:push` (or `psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql`)
4. Create a Storage bucket named `media` (or whatever you set `VITE_SUPABASE_STORAGE_BUCKET` to) and make it public-read
5. Enable Google OAuth in **Authentication → Providers** and add both of these redirect URLs:
   - `http://localhost:3000`
   - `http://localhost:3000/auth/callback`
6. Run the app: `npm run dev`

## Google OAuth 2.0 Flow (Home Page)

The home page login uses Supabase Auth + Google OAuth and supports both:
- First-time users (auto-create app profile)
- Returning users (link to existing app profile)

Implementation flow:
1. Unauthenticated user lands on `/` and sees the login screen.
2. Clicking **Sync via Google** calls `supabase.auth.signInWithOAuth({ provider: 'google' })` with:
   - `redirectTo: /auth/callback`
   - scopes: `openid email profile`
   - `prompt=select_account` for explicit account selection.
3. Google redirects back to `/auth/callback`.
4. App resolves session via Supabase client (`detectSessionInUrl: true`, PKCE flow).
5. Auth context ensures an app user row exists by resolving in this order:
   - `auth_uid`
   - `id`
   - `email`
6. If no row exists, a new profile is created. If a row exists but is missing linkage, `auth_uid` is backfilled.

Best-practice checklist:
- Keep OAuth redirect URLs exact and environment-specific.
- Use PKCE (already enabled in `src/supabase.ts`).
- Never place `SUPABASE_SERVICE_ROLE_KEY` in browser-executed code.
- Return users to a clean route after callback (`/`) and display user-friendly errors when callback/session fails.
- Ensure users table has unique constraints for identifiers you rely on (`id`, `username`, and ideally `email` if business rules allow).

## Mimo (Xiaomi MiMo) dev setup

The dev environment talks to Xiaomi's MiMo via the OpenAI-compatible endpoint:

- Base URL: `https://api.xiaomimimo.com/v1`
- Auth header: `api-key: $MIMO_API_KEY` (NOT `Authorization: Bearer`, NOT `x-api-key`)
- Models: `mimo-v2-flash`, `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2-tts`
- CLI (installed globally): `@titenq/mimo-tui` → run `mimo-tui`; config at `%APPDATA%/mimo/config.json`

Helpers in [scripts/](scripts):

```bash
# Bash (git-bash / WSL)
source ./scripts/mimo-env.sh          # load MIMO_* into current shell
./scripts/mimo-ping.sh                # smoke-test (expects PONG)

# PowerShell
. .\scripts\mimo-env.ps1              # load MIMO_* into current session
```

The Anthropic-compatible endpoint `token-plan-sgp.xiaomimimo.com/anthropic` returns 401 for the current key — it needs a separate token-plan subscription. Until that is provisioned, Mimo cannot be used as a Claude-Code backend; it stays as an OpenAI-compatible provider.

## Architecture notes

The app still imports from `firebase/auth`, `firebase/firestore`, and `firebase/storage` across ~20 components. Those imports are rewritten at build time by Vite aliases (see [vite.config.ts](vite.config.ts)) to a Supabase-backed compatibility shim in [src/supabase-shim/](src/supabase-shim). The shim implements the Firestore SDK subset the app actually uses — `doc`, `collection`, `query`, `where`, `orderBy`, `limit`, `onSnapshot`, `getDoc(s)`, `setDoc`, `updateDoc`, `addDoc`, `deleteDoc`, `writeBatch`, `serverTimestamp`, `increment`, `arrayUnion/Remove`, `Timestamp` — by routing them to PostgREST queries and Supabase Realtime channels.

Divergences from Firestore to be aware of:
- `writeBatch` is sequential, not atomic. Wrap multi-row state changes in an RPC if atomicity matters.
- `increment()` executes an RPC (`apply_increments`) so parallel increments don't clobber each other.
- Subcollection paths (e.g. `transmissions/{id}/transmits`) are modeled as flat tables (`transmits`) with a foreign key.
- RLS policies in [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) approximate [firestore.rules](firestore.rules). Review before going to production.

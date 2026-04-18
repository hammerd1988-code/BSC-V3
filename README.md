<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Blood Sweat Code

Neural-link social / streaming / bounty app. Migrated from Firebase (Firestore + Auth + Storage) to **Supabase** (Postgres + Auth + Storage + Realtime).

View the original AI Studio app: https://ai.studio/apps/8b4535cd-ac06-4134-b563-47ea1678cce7

## Run Locally

**Prerequisites:** Node.js 20+ and a Supabase project.

1. Install dependencies: `npm install`
2. Copy env and fill in required values:
   - macOS/Linux: `cp .env.example .env.local`
   - Windows PowerShell: `Copy-Item .env.example .env.local`
   Then fill in:
   - `VITE_SUPABASE_URL` — `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` — project anon public key
   - `SUPABASE_DB_URL` — full Postgres connection string (use Session Pooler if IPv4-only)
   - `GEMINI_API_KEY` — server-side Gemini key
   - `VITE_GEMINI_API_KEY` — client-side Gemini key used by browser AI features
3. Apply schema migrations with the project script: `npm run db:push`
   - This uses `npx supabase` (recommended for this repo).
   - If migration history drifts, repair then re-run:
     - `npx supabase migration repair --status reverted 20260418041703`
     - `npx supabase migration repair --status reverted 20260418041859`
     - `npx supabase migration repair --status applied 0003`
4. Create a Storage bucket named `media` (or whatever you set `VITE_SUPABASE_STORAGE_BUCKET` to) and make it public-read
5. Enable Google OAuth in **Authentication → Providers** and add both of these redirect URLs:
   - `http://localhost:3000`
   - `http://localhost:3000/auth/callback`
6. Run the app:
   - `npm run dev:full` for full frontend + backend local workflows (recommended)
   - `npm run dev` for frontend-only development
7. Optional auth safety smoke-test: `npm run verify:auth`

## Frontend-Backend Connection Setup

For reliable landing page, login, and account creation workflows, keep origins aligned:

1. Frontend origin
   - `APP_URL` should match the URL users open in browser (for example `http://localhost:3000`).
2. Socket/API origin
   - Set `CLIENT_ORIGIN` to the frontend origin for backend CORS checks.
   - Set `VITE_SOCKET_URL` to the backend URL when frontend and backend are on different ports (for example `http://localhost:3001`).
   - If frontend and backend are same-origin in production, leave `VITE_SOCKET_URL` unset.
3. Browser AI key hygiene
   - Browser features use `VITE_GEMINI_API_KEY`; it is visible to client code by design.
   - Use a restricted key and enforce provider-side usage quotas.
   - Keep `GEMINI_API_KEY` for backend-only operations.
4. Webhook security
   - Set `AGENT_WEBHOOK_SECRET` in all environments.
   - In production, server rejects webhook requests if this secret is missing.

## Google OAuth 2.0 Flow (Login + Account Creation)

The auth entry page supports both sign-in and account creation with Google OAuth.

Implementation flow:
1. User hits any protected route while unauthenticated and is shown the auth screen.
2. Choosing **Sync via Google** starts sign-in mode (`prompt=select_account`).
3. Choosing **Create Account** starts sign-up mode (`prompt=consent select_account`).
4. Both modes redirect to `/auth/callback?next=<safe-path>`.
5. Callback finalizes session using Supabase client (`detectSessionInUrl: true`, PKCE).
6. Auth context ensures a profile row exists by resolving in this order:
   - `auth_uid`
   - `id`
   - `email`
7. If no row exists, profile is created; otherwise linkage fields are backfilled (`auth_uid`, `email`, metadata fields).
8. User is redirected to the requested in-app destination (`next`) using a same-origin safe path check.

Best-practice checklist:
- Keep OAuth redirect URLs exact per environment (local, preview, production).
- Keep PKCE enabled in client auth config.
- Use explicit account selection on sign-in and explicit consent on create-account.
- Preserve user intent through callback with a validated `next` route (no open redirects).
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
- Never expose `GEMINI_API_KEY` (server key) to browser code.
- Keep `users.id`, `users.username`, and identifier fields constrained/indexed for profile lookup.

## OAuth Troubleshooting

If Google login or account creation fails, check these in order:

1. Redirect URL mismatch
   - In Supabase Auth provider settings, include both exact URLs:
     - `http://localhost:3000`
     - `http://localhost:3000/auth/callback`
0. Unsupported provider / provider not enabled
   - Error example: `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`
   - Fix: In Supabase Dashboard for the same project URL used by the app, go to Authentication → Providers → Google and enable it.
   - Then set Google OAuth client ID/secret and save.
1. Google OAuth redirect_uri_mismatch error
   - Error: `Error 400: redirect_uri_mismatch — You can't sign in to this app because it doesn't comply with Google's OAuth 2.0 policy.`
   - Fix: Add the Supabase callback URI to your Google Cloud Console:
     1. Open [Google Cloud Console](https://console.cloud.google.com)
     2. Go to APIs & Services → Credentials
     3. Find your OAuth 2.0 Client ID (ID: 575596623182-egvckpi1rf599stu0ef2t8fchrrm86q4.apps.googleusercontent.com)
     4. Edit it and go to **Authorized redirect URIs** section
     5. Click **Add URI** and paste exactly:
        ```
        https://kxfhxrdrlvnvtzdeuvwb.supabase.co/auth/v1/callback
        ```
     6. Click **Save**
     7. Wait 1-2 minutes for propagation, then retry sign-in
2. Incorrect app origin
   - Ensure `APP_URL` in `.env.local` matches the origin you are using in browser.
3. Invalid client keys
   - Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are from the same Supabase project.
4. Callback returns no session
   - Clear stale auth state/cookies, then retry.
   - Watch callback URL for `error` or `error_description` query/hash params.
5. Migration history drift blocks setup
   - Use:
     - `npx supabase migration repair --status reverted 20260418041703`
     - `npx supabase migration repair --status reverted 20260418041859`
     - `npx supabase migration repair --status applied 0003`
   - Then run `npm run db:push`.

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

The app now uses native Supabase APIs across auth, database, storage, and realtime flows.

Key conventions:
- Postgres schema uses `snake_case`; TypeScript app code uses `camelCase`.
- Auth is Google OAuth via Supabase Auth with PKCE and callback route finalization.
- Profile resolution and account linking are handled in [src/AuthContext.tsx](src/AuthContext.tsx).
- RLS and schema are maintained through numbered SQL migrations in [supabase/migrations](supabase/migrations).

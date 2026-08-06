# Blood Sweat Code — AI Agent Instructions

Neural-link social streaming platform fully migrated to native Supabase. This guide helps AI agents be immediately productive.

## Quick Start

```bash
npm install                       # Install dependencies
npm run dev                      # Start dev server (localhost:3000)
npm run db:push                  # Apply Supabase migrations
npm run db:reset                 # Reset database (WARNING: destructive)
```

## Essential Context

### 🔄 Architecture
- **Stack**: Native Supabase client (Postgres + Auth + Storage + Realtime), SQL migrations, and Socket.IO for signaling.
- **No Firebase**: The codebase has no Firebase dependencies.

### 📁 Project Structure
- `src/components/` - React components
- `supabase/migrations/` - Numbered SQL migrations (0001_init.sql, etc.)
- `scripts/` - MiMo AI CLI tools and database utilities
- `.env.local` - Environment variables (VITE_ prefix for client-side)

### 🗃️ Database Conventions
- **Naming**: Always use `snake_case` in database, convert to/from `camelCase` in TypeScript
- **IDs**: Text primary keys (e.g., "bot-username"); new rows default to UUID strings
- **Timestamps**: ISO strings in TypeScript, `timestamptz` in Postgres
- **Arrays**: Stored as Postgres arrays (`text[]`), not JSON

### 🔐 Authentication & Security
- Google OAuth primary provider
- RLS policies enforce user/admin/moderator roles
- Bot users have type='bot' and special permissions
- Service role key required for admin operations

### ⚡ Real-time Patterns
- Use Supabase channels with `postgres_changes` for live data subscriptions
- Cleanup subscriptions properly to avoid memory leaks
- Use channel presence for online status tracking

### 🤖 AI Integration
- MiMo CLI for development assistance (see [docs/MIMO_CLI_GUIDE.md](docs/MIMO_CLI_GUIDE.md))
- Gemini API for bot personas and content generation
- Bot users managed via `src/lib/botPersonas.ts`

## Common Tasks

### Adding a New Feature
1. Use existing patterns from similar components
2. Maintain snake_case in database, camelCase in TypeScript
3. Test with `npx tsx --env-file=.env.local scripts/verify-database.ts`

### Debugging Database Issues
- Check `.env.local` for correct Supabase URL and keys
- Verify RLS policies aren't blocking access
- Use Supabase Studio for direct database inspection
- Review migration files in `supabase/migrations/`

### Working with Real-time
```typescript
// Pattern: Subscribe to changes
const channel = supabase.channel('posts')
  .on('postgres_changes', {
    event: '*',
    schema: 'public', 
    table: 'posts'
  }, handleChange)
  .subscribe();

// Always cleanup
return () => { supabase.removeChannel(channel); };
```

## Warnings

- **DO NOT** use camelCase in SQL or database field names
- **DO NOT** forget to handle RLS policy errors gracefully

## Cloud / container dev environment

The repo carries two scripts that bring up a fully local, self-contained stack (local
Supabase in Docker + Express + Vite). No external secrets are needed for core development.

| Script | Phase | What it does |
|--------|-------|--------------|
| `scripts/cloud-agent-install.sh` | one-time | Installs Docker + the Supabase CLI, `npm ci` at the root and in `packages/casper-ssh-mobile`, and seeds `.env.local` from `scripts/cloud-agent.env.local`. |
| `scripts/cloud-agent-start.sh` | every boot | Starts `dockerd`, brings up `supabase start`, and waits for the API gateway to answer. Recreates the stack once if a snapshot left stale containers behind. |

Local endpoints once `cloud-agent-start.sh` returns: API `http://127.0.0.1:54321`,
Postgres `127.0.0.1:5432` (postgres/postgres), Studio `127.0.0.1:54323`,
Mailpit `http://127.0.0.1:54324`.

- `server.ts` does not load dotenv itself, so run it as
  `npx tsx --env-file=.env.local server.ts`.
- Browse the app at `http://localhost:3000`; that origin is in the local auth redirect
  allowlist and `:3001` is not.
- Sign in locally with the **magic link** form and read the mail in Mailpit. GoTrue falls
  back to `site_url`, so rewrite the link's `redirect_to` to
  `http://localhost:3000/auth/callback` and open it in the browser that requested it (the
  PKCE verifier is in that browser's localStorage).
- `npm run db:reset` replays `supabase/migrations/` from scratch and works — the chain is
  covered by `supabase/migrations.test.ts`, which applies it to PGlite in CI. `npm run
  db:push` targets the linked **remote** project; don't run it unless you mean to migrate
  production.
- Do not commit `supabase/.branches/` or `supabase/.temp/` (both are gitignored).

## Verification

`.github/workflows/ci.yml` runs exactly these, and all four pass on a clean checkout:

```bash
npm ci --include=dev
npm --prefix packages/casper-ssh-mobile ci --include=dev   # required before test:run
npm run lint          # tsc --noEmit
npm run lint:mobile
npm run test:run      # vitest, includes the PGlite migration chain test
npm run build
```

`packages/casper-cli` and `packages/desktop` have their own tsconfigs and are **not**
covered by `npm run lint`.

## Custom Agents

- [.agent.md](.agent.md) - Specialized Supabase development agent

## Resources

- Original app: https://ai.studio/apps/8b4535cd-ac06-4134-b563-47ea1678cce7
- Supabase docs: https://supabase.com/docs
- Project README: [README.md](README.md)
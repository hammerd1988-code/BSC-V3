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

## Cursor Cloud specific instructions

The cloud VM runs a fully local, self-contained stack: local Supabase (Docker) + Express backend + Vite frontend. No external secrets are required for core development.

### Starting services (in order)

1. **Docker daemon** — not a system service here; start it manually and make the socket accessible:
   `sudo dockerd` (run in background/tmux), then `sudo chmod 666 /var/run/docker.sock`.
2. **Local Supabase** — `npx supabase start` (from repo root). Data persists in Docker volumes across restarts. API: `http://127.0.0.1:54321`, Postgres: `127.0.0.1:5432` (postgres/postgres), Studio: `127.0.0.1:54323`, Mailpit (email inbox): `http://127.0.0.1:54324`.
3. **Backend** — `npx tsx --env-file=.env.local server.ts` (port 3001). `server.ts` does NOT load dotenv itself, so plain `npm run dev:full` will crash without env vars in the process environment — always use `--env-file=.env.local`.
4. **Frontend** — `npm run dev` (Vite, port 3000; proxies `/api` and `/socket.io` to 3001). Browse the app at `http://localhost:3000` (this origin matches the local auth redirect allowlist; port 3001 does not).

`.env.local` (gitignored, present on the VM) points at the local Supabase stack. If it is missing (e.g. after a fresh checkout), restore it with `cp ~/bsc-env-local-backup /workspace/.env.local`. Health check: `GET http://localhost:3000/api/health`.

### Local auth / test login (no Google OAuth needed locally)

- Use the **magic link** form on the login screen. Emails land in Mailpit (`http://127.0.0.1:54324`).
- The link in the email has `redirect_to=https://bloodsweatcode.org` (GoTrue falls back to `site_url` because the app's `?next=` redirect is not an exact allowlist match). Before opening it, rewrite the `redirect_to` query param to `http://localhost:3000/auth/callback`, and open the link in the SAME browser that submitted the email (PKCE verifier lives in its localStorage).
- Existing local test users: `dev@bsc.local` (DevOperator) and `dryrun@bsc.local`.

### Local database warnings (migration drift)

- **Do NOT run `npm run db:reset` / `supabase db reset` locally** — replaying `supabase/migrations/` from scratch fails (e.g. `0017` references `transmits.receiver_id` which no migration creates; `0023_casper_control_center.sql` seeds skill keys that violate its own regex check; duplicate versions `0023`/`0059` collide in the history table). The local DB was built once with manual fix-ups; treat it as persistent state.
- `npm run db:push` targets the linked REMOTE project — do not run it unless intentionally migrating production.
- The fresh local Postgres image uses hardened default privileges (no automatic DML grants to `anon`/`authenticated`), unlike the older production project. Legacy-style grants were applied manually to match production; if a NEW migration creates tables via `psql`/CLI locally, grants for `anon`/`authenticated`/`service_role` are inherited from altered default privileges already configured.
- Do not commit `supabase/.branches/` or `supabase/.temp/start-secrets/` (generated by `supabase start`).

### Lint / test / build

- `npm run lint` (tsc), `npm run test:run` (Vitest), `npm run build` — see README/CLAUDE.md for the full command list.
- Known pre-existing failure: `packages/casper-ssh-mobile/src/storage/hosts.test.ts` fails to load (its tsconfig extends `expo/tsconfig.base`, and that package's deps are not installed at the root). All other suites pass.
- Server-side AI, LiveKit, Square/Stripe, and push features degrade gracefully without keys; the backend logs which providers are disabled at boot.

## Custom Agents

- [.agent.md](.agent.md) - Specialized Supabase development agent

## Resources

- Original app: https://ai.studio/apps/8b4535cd-ac06-4134-b563-47ea1678cce7
- Supabase docs: https://supabase.com/docs
- Project README: [README.md](README.md)
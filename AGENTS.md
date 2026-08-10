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

## Merge discipline (required — past outages came from ignoring this)

Two production incidents on this repo came from merge handling, not from the
code being authored. Follow these rules exactly:

1. **Never merge before the CI `verify` check has completed on the exact
   commit being merged.** A conflict resolution was once merged 14 seconds
   after push — the CI job takes ~80 seconds, so nothing had a chance to
   report — and main was unbootable for hours.
2. **Never resolve a merge conflict by keeping both sides.** That resolution
   once landed a duplicate block mid-object-literal in `server.ts` (22 syntax
   errors, dead entrypoint) and a duplicated `post:like` emit in `Feed.tsx`
   that type-checked and shipped. Read both sides, understand which change
   supersedes which, and produce one intentional result. If the two sides are
   independent changes to the same region, verify the combined behavior — not
   just that the file parses.
3. **After any conflict resolution, run `npm run lint` AND
   `bash scripts/ci-smoke.sh`** before pushing. The smoke script boots the
   real server entrypoint with stub credentials and requires `/api/health` to
   answer — it catches import-time and init-time breakage that typecheck,
   tests, and `vite build` all miss.
4. A previous "reconciliation" merge silently dropped three security fixes.
   When resolving conflicts in security-sensitive code (auth middleware,
   webhook verification, RLS-adjacent server routes), diff the resolution
   against **both** parents and confirm nothing protective was discarded.

## Custom Agents

- [.agent.md](.agent.md) - Specialized Supabase development agent

## Resources

- Original app: https://ai.studio/apps/8b4535cd-ac06-4134-b563-47ea1678cce7
- Supabase docs: https://supabase.com/docs
- Project README: [README.md](README.md)

## Cursor Cloud specific instructions

The Cloud Agent environment runs the whole stack locally with **no external
secrets** by standing up the Supabase CLI local stack (Postgres + Auth + Storage
+ Realtime) inside the VM via nested Docker.

- Bootstrap (one-time, idempotent): `scripts/cloud-agent-install.sh` — installs
  Docker + the Supabase CLI, runs `npm ci` for the root app and
  `packages/casper-ssh-mobile`, and writes `.env.local` from
  `scripts/cloud-agent.env.local` (wired to the local Supabase stack with the
  well-known CLI demo keys — not real secrets).
- Per-boot services: `scripts/cloud-agent-start.sh` — clears a stale
  legacy-iptables `FORWARD DROP` (otherwise Docker's bridge network silently
  drops container-to-container traffic and `supabase start` hangs on the realtime
  container), starts `dockerd` with the `fuse-overlayfs` storage driver, then
  runs `supabase start`.
- Run the app: `npx tsx --env-file=.env.local server.ts` — one process serves the
  frontend (Vite middleware), the REST/Socket.io API, on `http://localhost:3001`.
- Supabase URLs: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`,
  Mailpit (captured emails) `http://127.0.0.1:54324`.
- The numbered SQL migrations are validated to apply cleanly from scratch via
  `supabase db reset`; keep them that way (unique numeric version prefixes, no
  phantom columns, `text` FKs to `users.id`/`gladiators.id`).
- Google OAuth sign-in needs real Google credentials, so it can't complete in the
  local stack. Everything up to the auth boundary runs end-to-end; the passwordless
  email magic-link flow can be exercised via Mailpit if a login is needed.
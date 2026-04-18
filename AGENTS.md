# Blood Sweat Code — AI Agent Instructions

Neural-link social streaming platform migrating from Firebase to Supabase. This guide helps AI agents be immediately productive.

## Quick Start

```bash
npm install                       # Install dependencies
npm run dev                      # Start dev server (localhost:3000)
npm run db:push                  # Apply Supabase migrations
npm run db:reset                 # Reset database (WARNING: destructive)
```

## Essential Context

### 🔄 Migration State
- **Active Migration**: Firebase → Supabase via compatibility shim (`src/supabase-shim/`)
- **Import Rewriting**: Firebase imports are aliased to shim at build time (see `vite.config.ts`)
- **Dual Patterns**: Code may contain both Firebase SDK calls and native Supabase patterns

### 📁 Project Structure
- `src/components/` - React components (20+ using Firebase imports)
- `src/supabase-shim/` - Firebase SDK compatibility layer
- `supabase/migrations/` - Numbered SQL migrations (0001_init.sql, etc.)
- `scripts/` - MiMo AI CLI tools and database utilities
- `.env.local` - Environment variables (VITE_ prefix for client-side)

### 🗃️ Database Conventions
- **Naming**: Always use `snake_case` in database, convert to/from `camelCase` in TypeScript
- **IDs**: Text primary keys for compatibility with Firebase doc IDs (e.g., "bot-username")
- **Timestamps**: ISO strings in TypeScript, `timestamptz` in Postgres
- **Arrays**: Stored as Postgres arrays (`text[]`), not JSON

### 🔐 Authentication & Security
- Google OAuth primary provider
- RLS policies enforce user/admin/moderator roles
- Bot users have type='bot' and special permissions
- Service role key required for admin operations

### ⚡ Real-time Patterns
- Firestore `onSnapshot` → Supabase channels with `postgres_changes`
- Cleanup subscriptions properly to avoid memory leaks
- Use channel presence for online status tracking

### 🤖 AI Integration
- MiMo CLI for development assistance (see [docs/MIMO_CLI_GUIDE.md](docs/MIMO_CLI_GUIDE.md))
- Gemini API for bot personas and content generation
- Bot users managed via `src/lib/botPersonas.ts`

## Common Tasks

### Adding a New Feature
1. Check migration audit: [supabase_migration_audit.md](supabase_migration_audit.md)
2. Use existing patterns from similar components
3. Maintain snake_case in database, camelCase in TypeScript
4. Test with `npx tsx --env-file=.env.local scripts/verify-database.ts`

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

- **DO NOT** mix Firebase and Supabase imports in new files
- **DO NOT** use camelCase in SQL or database field names
- **DO NOT** forget to handle RLS policy errors gracefully
- **ALWAYS** use the shim for components still importing Firebase

## Custom Agents

- [.agent.md](.agent.md) - Specialized Supabase development agent

## Resources

- Original app: https://ai.studio/apps/8b4535cd-ac06-4134-b563-47ea1678cce7
- Supabase docs: https://supabase.com/docs
- Project README: [README.md](README.md)
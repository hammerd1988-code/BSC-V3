# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Vite dev server only (port 3000)
npm run dev:full      # Express (port 3001) + Vite (port 5173) together — use this for full-stack work
npm run build         # Production build
npm run start         # Production server (node --experimental-strip-types server.ts)
npm run lint          # TypeScript type-check (no emit)
npm run db:push       # Push Supabase schema migrations
npm run db:reset      # Reset Supabase database
npm run db:migrate    # Run pending migrations
```

**Setup:** copy `.env.example` → `.env.local`, fill in Supabase and API keys, then `npm run db:push` before first run.

Required env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_STORAGE_BUCKET`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `AGENT_WEBHOOK_SECRET`, `APP_URL`.

## Architecture

**Blood Sweat Code** is a full-stack social/streaming platform with AI bot integration.

- **Frontend:** React 19 + React Router v7 + Tailwind CSS, built with Vite
- **Backend:** Express.js + Socket.io (`server.ts`) — handles webhook ingestion, WebRTC signaling, live stream crowd state
- **Database:** Supabase (Postgres) with Row-Level Security
- **Auth:** Supabase Auth + Google OAuth, managed in `src/AuthContext.tsx`
- **AI:** Google Gemini API (primary), OpenAI SDK (secondary)
- **Real-time:** Socket.io for notifications/WebRTC + Supabase Realtime channels for DB changes

## Firebase → Supabase Shim

The codebase was migrated from Firebase but many components still use Firebase SDK import paths. Vite aliases (`vite.config.ts`) intercept all `firebase/auth`, `firebase/firestore`, and `firebase/storage` imports and redirect them to `src/supabase-shim/`. This means existing code using `getDoc`, `setDoc`, `collection`, `query`, etc. still works — it runs against Supabase under the hood.

Key files:
- `src/supabase-shim/firestore.ts` — implements Firestore SDK surface over Supabase PostgREST + Realtime
- `src/supabase-shim/auth.ts` — wraps Supabase Auth to match Firebase Auth API
- `src/supabase-shim/storage.ts` — wraps Supabase Storage
- `src/supabase.ts` — raw Supabase client + `toDb()` / `fromDb()` field mappers

**Naming convention:** TypeScript uses camelCase; Postgres columns use snake_case. Always use `toDb()` when writing to Supabase and `fromDb()` when reading, rather than manually mapping fields.

`WriteBatch` is sequential (not atomic). `increment()` calls use Postgres RPC functions.

## State Management

No Redux or Zustand — purely React Context + hooks:
- `src/AuthContext.tsx` — `currentUser`, `supabaseUser`, loading state; subscribes to auth changes and real-time profile updates
- `src/CallContext.tsx` — WebRTC call signaling state

Real-time data uses Supabase `channel().on('postgres_changes', ...)` subscriptions inside components, plus Socket.io events from `server.ts`.

## Key Source Areas

| Path | Purpose |
|------|---------|
| `src/App.tsx` | Route definitions |
| `src/components/` | All UI components (Feed, Profile, Transmissions, etc.) |
| `src/lib/` | Shared helpers: `ai.ts`, `botPersonas.ts`, `socket.ts`, `crypto.ts` |
| `src/types/` | TypeScript types for User, Post, Transmission, Bounty, etc. |
| `supabase/migrations/0001_init.sql` | Full DB schema + RLS policies |
| `server.ts` | Express API routes + Socket.io event handlers |
| `firestore.rules` | Original Firestore rules — reference these to understand RLS intent |

## Database Schema Overview

Core tables: `users`, `posts`, `post_likes`, `comments`, `transmissions` (DM threads), `transmits` (messages), `streams`, `stream_chat`, `bounties`, `transactions`, `void_posts`, `active_threats`.

`hammerd1988@gmail.com` is hardcoded as the admin user in `src/AuthContext.tsx`.

## Feature Areas

- **Feed** — social timeline, posts, likes, comments
- **Void Feed** — anonymous ephemeral posts with decay
- **Transmissions** — encrypted direct messaging
- **Neural Job Market** — bounty/task postings for AI bots
- **Neural Rankings** — leaderboard with CRED currency
- **Bot Terminal** — direct AI bot interaction
- **Live Streaming** — with Socket.io crowd tracking and stream chat
- **Admin Dashboard** — moderation and threat level management

## Bot Personas

Hardcoded AI bot personas are defined in `src/lib/botPersonas.ts` and auto-seeded into the `users` table on first admin login. Bots respond to bounties and interact with the platform via `src/lib/ai.ts` (Gemini) and webhook ingestion in `server.ts`.

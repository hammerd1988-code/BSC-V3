-- Migration 0008: Add core tables to realtime publication and set REPLICA IDENTITY FULL
-- This enables Supabase Realtime to fire events for these tables, including
-- filtered subscriptions on non-primary-key columns (e.g. username, author_id).
-- NOTE: This migration was already applied directly to the DB via MCP execute_sql.

alter publication supabase_realtime add table public.users;
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.transmissions;
alter publication supabase_realtime add table public.transmits;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.follows;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.bounties;

-- REPLICA IDENTITY FULL allows realtime to include old row data in UPDATE/DELETE
-- events, which is required for column-level filters to work correctly.
alter table public.users replica identity full;
alter table public.posts replica identity full;
alter table public.transmissions replica identity full;
alter table public.transmits replica identity full;
alter table public.notifications replica identity full;

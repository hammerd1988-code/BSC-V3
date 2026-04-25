-- Migration 0009: Add active_poll column to streams and set REPLICA IDENTITY FULL
-- NOTE: Already applied directly to the DB via MCP execute_sql.

-- Add active_poll column for live poll feature in GoLive
ALTER TABLE public.streams ADD COLUMN IF NOT EXISTS active_poll jsonb DEFAULT NULL;

-- Set REPLICA IDENTITY FULL so realtime can fire on streams updates
-- (required for crowd_size changes to propagate to viewers in real-time)
ALTER TABLE public.streams REPLICA IDENTITY FULL;

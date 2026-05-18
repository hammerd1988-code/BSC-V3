-- ============================================================================
-- Migration: bot_conversations & bot_instructions tables
-- For: Bot Chat, Flash Directive, instruction logging
-- Idempotent — safe to re-paste in Supabase SQL Editor
-- ============================================================================

-- ── bot_conversations ──────────────────────────────────────────────────────
-- Stores the latest conversation (up to 100 messages) between a user and a bot.
-- Upserted on (user_id, bot_id).

CREATE TABLE IF NOT EXISTS bot_conversations (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_id        text NOT NULL,
  bot_name      text NOT NULL DEFAULT '',
  messages      jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_active   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint for upsert (onConflict: 'user_id,bot_id')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_conversations_user_id_bot_id_key'
  ) THEN
    ALTER TABLE bot_conversations
      ADD CONSTRAINT bot_conversations_user_id_bot_id_key UNIQUE (user_id, bot_id);
  END IF;
END $$;

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_bot_conversations_user_id ON bot_conversations(user_id);

-- Index for fast lookups by bot
CREATE INDEX IF NOT EXISTS idx_bot_conversations_bot_id ON bot_conversations(bot_id);

-- RLS
ALTER TABLE bot_conversations ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own conversations
DROP POLICY IF EXISTS "Users manage own bot conversations" ON bot_conversations;
CREATE POLICY "Users manage own bot conversations" ON bot_conversations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass
DROP POLICY IF EXISTS "Service role full access to bot_conversations" ON bot_conversations;
CREATE POLICY "Service role full access to bot_conversations" ON bot_conversations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ── bot_instructions ───────────────────────────────────────────────────────
-- Logs every instruction sent to a bot (from Bot Chat CMD mode or Flash Directive).

CREATE TABLE IF NOT EXISTS bot_instructions (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_id            text NOT NULL,
  instruction       text NOT NULL,
  response          text,                          -- bot's response (Flash Directive stores this)
  instruction_type  text NOT NULL DEFAULT 'chat',  -- 'chat' | 'flash_directive'
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Index for fetching instructions by user + bot
CREATE INDEX IF NOT EXISTS idx_bot_instructions_user_bot ON bot_instructions(user_id, bot_id);

-- Index for chronological queries
CREATE INDEX IF NOT EXISTS idx_bot_instructions_created_at ON bot_instructions(created_at DESC);

-- RLS
ALTER TABLE bot_instructions ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own instructions
DROP POLICY IF EXISTS "Users manage own bot instructions" ON bot_instructions;
CREATE POLICY "Users manage own bot instructions" ON bot_instructions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass
DROP POLICY IF EXISTS "Service role full access to bot_instructions" ON bot_instructions;
CREATE POLICY "Service role full access to bot_instructions" ON bot_instructions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 0056_casper_user_context_note.sql
-- Per-user Casper context note + memory type expansion for project/context facts.

-- 1. Add a per-user context note that is always prepended to Casper's system prompt.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS context_note text,
  ADD COLUMN IF NOT EXISTS context_note_updated_at timestamptz;

-- 2. Expand casper_memories.memory_type to accept project/context facts.
ALTER TABLE public.casper_memories
  DROP CONSTRAINT IF EXISTS casper_memories_memory_type_check;

ALTER TABLE public.casper_memories
  ADD CONSTRAINT casper_memories_memory_type_check
  CHECK (memory_type IN (
    'conversation', 'network', 'mood', 'world',
    'workspace', 'preference', 'skill', 'tool_usage',
    'exchange', 'context', 'project'
  ));

-- 3. Keep a fast lookup of a user's context memories (if stored as memories).
CREATE INDEX IF NOT EXISTS casper_memories_context_type_idx
  ON public.casper_memories (user_id, created_at DESC)
  WHERE memory_type = 'context';

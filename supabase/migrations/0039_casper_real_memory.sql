-- 0039_casper_real_memory.sql
-- Upgrade Casper's memory system with full-text search, structured context,
-- conversation history, workspace memory, and preference learning.

-- 1. Expand memory_type constraint to include new categories
ALTER TABLE public.casper_memories DROP CONSTRAINT IF EXISTS casper_memories_memory_type_check;
ALTER TABLE public.casper_memories ADD CONSTRAINT casper_memories_memory_type_check
  CHECK (memory_type IN (
    'conversation', 'network', 'mood', 'world',
    'workspace', 'preference', 'skill', 'tool_usage',
    'exchange'
  ));

-- 2. Add structured context column (workspace info, tool calls, metadata)
ALTER TABLE public.casper_memories ADD COLUMN IF NOT EXISTS context jsonb;

-- 3. Add session_id to group conversation memories within a session
ALTER TABLE public.casper_memories ADD COLUMN IF NOT EXISTS session_id text;

-- 4. Add full-text search vector column
ALTER TABLE public.casper_memories ADD COLUMN IF NOT EXISTS search_text tsvector;

-- 5. Create GIN index on the search vector for fast full-text queries
CREATE INDEX IF NOT EXISTS casper_memories_search_idx
  ON public.casper_memories USING gin (search_text);

-- 6. Index on session_id for conversation history retrieval
CREATE INDEX IF NOT EXISTS casper_memories_session_idx
  ON public.casper_memories (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

-- 7. Index on context for JSONB queries (e.g. workspace lookups)
CREATE INDEX IF NOT EXISTS casper_memories_context_idx
  ON public.casper_memories USING gin (context jsonb_path_ops)
  WHERE context IS NOT NULL;

-- 8. Function to auto-generate search_text from content + tags
CREATE OR REPLACE FUNCTION public.update_memory_search_text()
RETURNS trigger AS $$
BEGIN
  NEW.search_text := to_tsvector('english',
    coalesce(NEW.content, '') || ' ' ||
    coalesce(NEW.memory_type, '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Trigger to auto-populate search_text on insert/update
DROP TRIGGER IF EXISTS trg_memory_search_text ON public.casper_memories;
CREATE TRIGGER trg_memory_search_text
  BEFORE INSERT OR UPDATE OF content, tags, memory_type
  ON public.casper_memories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_memory_search_text();

-- 10. Backfill search_text for existing rows
UPDATE public.casper_memories
SET search_text = to_tsvector('english',
  coalesce(content, '') || ' ' ||
  coalesce(memory_type, '') || ' ' ||
  coalesce(array_to_string(tags, ' '), '')
)
WHERE search_text IS NULL;

-- 11. RPC function for full-text memory search with ranking
CREATE OR REPLACE FUNCTION public.search_casper_memories(
  query_text text,
  p_user_id text DEFAULT NULL,
  p_memory_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  user_id text,
  memory_type text,
  content text,
  importance integer,
  tags text[],
  context jsonb,
  session_id text,
  created_at timestamptz,
  last_accessed timestamptz,
  access_count integer,
  rank real
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.user_id,
    m.memory_type,
    m.content,
    m.importance,
    m.tags,
    m.context,
    m.session_id,
    m.created_at,
    m.last_accessed,
    m.access_count,
    (ts_rank_cd(m.search_text, websearch_to_tsquery('english', query_text)) * m.importance::real) AS rank
  FROM public.casper_memories m
  WHERE m.search_text @@ websearch_to_tsquery('english', query_text)
    AND (p_user_id IS NULL OR m.user_id = p_user_id OR m.user_id IS NULL)
    AND (p_memory_types IS NULL OR m.memory_type = ANY(p_memory_types))
  ORDER BY rank DESC, m.importance DESC, m.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- 12. RPC function to get conversation history for a user session
CREATE OR REPLACE FUNCTION public.get_casper_conversation_history(
  p_user_id text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  content text,
  context jsonb,
  session_id text,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.context,
    m.session_id,
    m.created_at
  FROM public.casper_memories m
  WHERE m.user_id = p_user_id
    AND m.memory_type = 'exchange'
  ORDER BY m.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

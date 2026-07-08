-- 0046_casper_memory_pinned.sql
-- Add a "pinned" flag to Casper memories so users can protect important
-- memories from automatic pruning, and expose per-user memory statistics.

-- 1. Add pinned column (default false). Pinned memories are never auto-pruned.
ALTER TABLE public.casper_memories
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- 2. Partial index for quickly listing a user's pinned memories.
CREATE INDEX IF NOT EXISTS casper_memories_pinned_idx
  ON public.casper_memories (user_id, created_at DESC)
  WHERE pinned = true;

-- 3. RPC: per-user memory statistics (counts by type + totals + date range).
--    Returns one row per memory_type plus an aggregate row (memory_type = 'all').
CREATE OR REPLACE FUNCTION public.casper_memory_stats(p_user_id text)
RETURNS TABLE (
  memory_type text,
  total bigint,
  pinned_count bigint,
  avg_importance numeric,
  oldest timestamptz,
  newest timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.memory_type,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE m.pinned)::bigint AS pinned_count,
    round(avg(m.importance)::numeric, 1) AS avg_importance,
    min(m.created_at) AS oldest,
    max(m.created_at) AS newest
  FROM public.casper_memories m
  WHERE m.user_id::text = p_user_id
  GROUP BY m.memory_type
  UNION ALL
  SELECT
    'all'::text AS memory_type,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE m.pinned)::bigint AS pinned_count,
    round(avg(m.importance)::numeric, 1) AS avg_importance,
    min(m.created_at) AS oldest,
    max(m.created_at) AS newest
  FROM public.casper_memories m
  WHERE m.user_id::text = p_user_id;
END;
$$ LANGUAGE plpgsql STABLE;

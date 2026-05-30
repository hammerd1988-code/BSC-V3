-- Battle Comments: comment threads on completed matches
-- Users can discuss, analyze, and trash-talk about past battles

CREATE TABLE IF NOT EXISTS public.battle_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id text NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  display_name text NOT NULL DEFAULT 'Anonymous',
  avatar_url text NOT NULL DEFAULT '',
  body text NOT NULL CHECK (char_length(body) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_battle_comments_match ON public.battle_comments(match_id, created_at);

ALTER TABLE public.battle_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read battle comments
DROP POLICY IF EXISTS battle_comments_read ON public.battle_comments;
CREATE POLICY battle_comments_read ON public.battle_comments
  FOR SELECT USING (true);

-- Authenticated users can insert their own comments
DROP POLICY IF EXISTS battle_comments_insert ON public.battle_comments;
CREATE POLICY battle_comments_insert ON public.battle_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_uid = (SELECT auth.uid())
        AND u.id = battle_comments.user_id
    )
  );

-- Users can delete their own comments, admins can delete any
DROP POLICY IF EXISTS battle_comments_delete ON public.battle_comments;
CREATE POLICY battle_comments_delete ON public.battle_comments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_uid = (SELECT auth.uid())
        AND (u.id = battle_comments.user_id OR u.role = 'admin')
    )
  );

-- Enable realtime for battle comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_comments;

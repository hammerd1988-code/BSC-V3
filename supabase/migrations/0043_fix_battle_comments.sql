-- Fix battle_comments: FK on user_id, text PK convention, impersonation-safe RLS
-- Idempotent — safe to run whether or not 0042 was already applied

-- If table already exists with uuid PK, alter to text (compatible cast)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'battle_comments'
      AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.battle_comments ALTER COLUMN id SET DATA TYPE text USING id::text;
    ALTER TABLE public.battle_comments ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
END $$;

-- Add FK on user_id if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'battle_comments'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'battle_comments_user_id_fkey'
  ) THEN
    ALTER TABLE public.battle_comments
      ADD CONSTRAINT battle_comments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Recreate INSERT policy to validate display_name and avatar_url against actual user profile
DROP POLICY IF EXISTS battle_comments_insert ON public.battle_comments;
CREATE POLICY battle_comments_insert ON public.battle_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_uid = (SELECT auth.uid())
        AND u.id = battle_comments.user_id
        AND coalesce(nullif(u.display_name, ''), u.username) = battle_comments.display_name
        AND coalesce(u.avatar_url, '') = battle_comments.avatar_url
    )
  );

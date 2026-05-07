-- =========================================================================
-- Reconcile casper_tasks schema with live production database.
--
-- During initial deployment, the 0018 CREATE TABLE IF NOT EXISTS was
-- silently skipped because the table already existed with a different
-- shape (extra user_id column, different priority constraint).  This
-- migration idempotently cleans up the drift discovered on 2025-05-07:
--
--   1. Drop the legacy "Users manage own tasks" RLS policy that
--      references the non-standard user_id column.
--   2. Drop the extraneous user_id column (the codebase uses created_by).
--   3. Ensure the priority CHECK constraint allows the values the
--      application actually sends: low, medium, high, urgent.
--   4. Re-apply the owner-based RLS policies with explicit ::text casts
--      so uuid ↔ text comparisons don't fail at runtime.
--   5. Reload the PostgREST schema cache.
-- =========================================================================

-- 1. Drop legacy policy that depends on user_id
DROP POLICY IF EXISTS "Users manage own tasks" ON public.casper_tasks;

-- 2. Drop the extraneous user_id column (code only uses created_by)
ALTER TABLE public.casper_tasks DROP COLUMN IF EXISTS user_id;

-- 3. Fix priority constraint to match application values
ALTER TABLE public.casper_tasks DROP CONSTRAINT IF EXISTS casper_tasks_priority_check;
ALTER TABLE public.casper_tasks ADD CONSTRAINT casper_tasks_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'urgent'));

-- 4. Re-apply owner-based RLS policies with safe ::text casts
DROP POLICY IF EXISTS casper_tasks_admin_read ON public.casper_tasks;
DROP POLICY IF EXISTS casper_tasks_admin_write ON public.casper_tasks;
DROP POLICY IF EXISTS casper_tasks_owner_read ON public.casper_tasks;
DROP POLICY IF EXISTS casper_tasks_owner_write ON public.casper_tasks;

CREATE POLICY casper_tasks_owner_read ON public.casper_tasks
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_uid::text = (SELECT auth.uid())::text
        AND (u.role = 'admin' OR u.id::text = casper_tasks.created_by::text)
    )
  );

CREATE POLICY casper_tasks_owner_write ON public.casper_tasks
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_uid::text = (SELECT auth.uid())::text
        AND (u.role = 'admin' OR u.id::text = casper_tasks.created_by::text)
    )
  ) WITH CHECK (
    created_by IS NULL
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_uid::text = (SELECT auth.uid())::text
        AND (u.role = 'admin' OR u.id::text = casper_tasks.created_by::text)
    )
  );

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

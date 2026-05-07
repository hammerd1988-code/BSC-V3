-- =========================================================================
-- Ensure casper_tasks.created_by column exists.
--
-- The original 0018 migration defined created_by inside CREATE TABLE IF
-- NOT EXISTS, so it was silently skipped when the table already existed
-- without that column.  The 0023 migration added other columns via ALTER
-- TABLE … ADD COLUMN IF NOT EXISTS but did not include created_by.
-- =========================================================================

alter table public.casper_tasks
  add column if not exists created_by uuid;

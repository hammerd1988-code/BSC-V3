-- Fix: allow global config rows (cognitive_core, schedule) in casper_config.
--
-- The live schema has per-user rows with user_id NOT NULL + UNIQUE.
-- The dashboard code creates global config rows (key='cognitive_core',
-- key='schedule') without a user_id.  This migration:
--
-- 1. Makes user_id nullable so global rows can omit it.
-- 2. Drops the user_id unique constraint so one user can own multiple rows
--    (their per-user row + any global config rows they create as admin).
-- 3. Adds an explicit INSERT RLS policy for admin users.

-- 1. Allow NULL user_id for global config rows
alter table public.casper_config alter column user_id drop not null;

-- 2. Drop the unique constraint on user_id (name from Postgres default naming)
alter table public.casper_config drop constraint if exists casper_config_user_id_key;

-- Also drop if it was named differently
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.casper_config'::regclass
    and contype = 'u'
    and array_length(conkey, 1) = 1
    and conkey[1] = (
      select attnum from pg_attribute
      where attrelid = 'public.casper_config'::regclass
        and attname = 'user_id'
    );
  if cname is not null then
    execute format('alter table public.casper_config drop constraint %I', cname);
  end if;
end $$;

-- 3. Ensure admin INSERT is explicitly allowed by RLS
drop policy if exists casper_config_admin_insert on public.casper_config;
create policy casper_config_admin_insert on public.casper_config
  for insert
  to authenticated
  with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

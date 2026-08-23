-- Admin operator fixes surfaced from production:
--
-- 1. Admins could not change another account's role. The only UPDATE policy
--    on public.users is `users self-update` (auth.uid() = auth_uid), so an
--    admin editing someone else's row silently updated 0 rows and the UI
--    reverted. Role self-escalation stays blocked by the 0060 trigger.
--
-- 2. The Cognitive Core "duplicate key value violates unique constraint
--    casper_config_key_unique" save error: the admin SELECT policy on
--    casper_config was not in effect in production, so the existing global
--    row (user_id is null) was invisible to the admin client, which then
--    tried to INSERT a duplicate. Re-assert the admin policies so live
--    projects converge with 0018/0036, using the shared is_admin_user()
--    helper (0057) to avoid self-referencing RLS recursion on users.

create or replace function public.is_admin_user()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where auth_uid = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists users_admin_update on public.users;
create policy users_admin_update on public.users
  for update
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists casper_config_admin_read on public.casper_config;
create policy casper_config_admin_read on public.casper_config
  for select
  to authenticated
  using (public.is_admin_user());

drop policy if exists casper_config_admin_write on public.casper_config;
create policy casper_config_admin_write on public.casper_config
  for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists casper_config_admin_insert on public.casper_config;
create policy casper_config_admin_insert on public.casper_config
  for insert
  to authenticated
  with check (public.is_admin_user());

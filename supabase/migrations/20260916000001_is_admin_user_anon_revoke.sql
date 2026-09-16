-- Every policy that calls public.is_admin_user() is `to authenticated`
-- (0057, 0058, 0068, 20260823 storylines), so anon never evaluates it.
-- 20260916000000 granted it to anon alongside authenticated; keep the helper
-- reachable only by the roles that actually need it. Postgres grants EXECUTE
-- on every function to PUBLIC by default, so that has to go first or the
-- anon revoke is a no-op on a fresh database.

revoke all on function public.is_admin_user() from public;
revoke execute on function public.is_admin_user() from anon;
grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.is_admin_user() to service_role;

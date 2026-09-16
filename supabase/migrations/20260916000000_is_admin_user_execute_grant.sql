-- Every UPDATE on public.users by a signed-in user failed in production with
-- `42501 permission denied for function is_admin_user`. The `users_admin_update`
-- policy (0068) calls public.is_admin_user(), and RLS evaluates every UPDATE
-- policy on the table as the calling role, so a missing EXECUTE grant on that
-- helper blocks the owner's own `Users can update own profile` path too. The
-- Casper AI Core "Save" silently did nothing as a result.
--
-- The live project had EXECUTE revoked from anon/authenticated on this function
-- (only postgres/service_role kept it). It is SECURITY DEFINER and only reports
-- whether the caller is an admin, so re-granting it to the API roles is safe.
-- The same helper gates casper_config and the bot_mayhem_* admin policies.

grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.is_admin_user() to anon;

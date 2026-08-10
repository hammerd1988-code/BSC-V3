-- Give scripts/verify-database.ts a real RLS check to call.
--
-- The script has always called `rpc('get_tables_with_rls_status')`, but no
-- migration ever defined it, so the only path its RLS step could take was the
-- "function missing" branch — which used to print "RLS is enabled in migration
-- file (0001_init.sql)" and return success. The check could not fail, and
-- AGENTS.md points operators at it after every schema change.
--
-- supabase/migrations.test.ts already asserts RLS on every public table against
-- the migration chain, but that proves the *chain* is right, not that the
-- database in front of you matches it. This is what answers the second question.
--
-- security invoker: pg_class and pg_namespace are readable by any role, so
-- definer rights would buy nothing. Execute is granted to service_role only —
-- the script already refuses to run its RLS step without the service key, and a
-- browser role gets a permission error, which it reports as "not verified"
-- rather than as a pass.

create or replace function public.get_tables_with_rls_status()
returns table (table_name text, rls_enabled boolean)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
    select c.relname::text, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
     order by c.relname;
$$;

revoke all on function public.get_tables_with_rls_status() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_tables_with_rls_status() to service_role;
  end if;
end;
$$;

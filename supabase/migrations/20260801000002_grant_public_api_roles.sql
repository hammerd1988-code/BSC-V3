-- Grant the PostgREST API roles access to the public schema.
--
-- Supabase's dashboard / table editor auto-grants privileges to anon,
-- authenticated, and service_role whenever a table is created through it. The
-- numbered SQL migrations in this repo predate that flow and were originally
-- applied to the live project through the dashboard, so the grants were never
-- written into the migration files. A from-scratch `supabase db reset` (used by
-- local development) therefore produces tables that the API roles cannot read or
-- write, surfacing as `permission denied for table ...` (SQLSTATE 42501).
--
-- Row Level Security is enabled on these tables and remains the real access
-- gate: anon/authenticated only see rows their policies allow, while
-- service_role intentionally bypasses RLS for privileged server-side work. These
-- grants only restore the schema/table reachability that Supabase normally sets
-- up automatically, so this migration is a safe no-op against the live project.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;

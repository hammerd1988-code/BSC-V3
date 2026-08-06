-- Make the PostgREST API roles able to reach tables created by later migrations.
--
-- Supabase's dashboard / table editor auto-grants privileges to anon,
-- authenticated and service_role whenever a table is created through it. The
-- numbered SQL migrations in this repo were originally applied to the live
-- project that way, so the grants were never written into the migration files.
-- A from-scratch `supabase db reset` (used by local development) therefore
-- produces tables that the API roles cannot read or write, surfacing as
-- `permission denied for table ...` (SQLSTATE 42501).
--
-- This runs first, and grants by default rather than in bulk at the end of the
-- chain, because migrations 0014-0063 deliberately revoke access to specific
-- tables: gladiators (it stores per-bot API keys), the server-owned colosseum
-- and tournament tables, and the CRED-moving functions. A
-- `grant all on all tables in schema public` late in the chain reverses every
-- one of those, and several of them pair the revoke with a narrower re-grant
-- (0055 hands authenticated `select` on gladiator_mutations and column-level
-- `update` on gladiators) that a bulk revoke/grant cannot reproduce. Default
-- privileges apply at CREATE TABLE time, so each of those statements then means
-- exactly what it says.
--
-- Routines are intentionally omitted. Postgres already grants EXECUTE on new
-- functions to PUBLIC, so a from-scratch reset can call them without help, and
-- adding direct anon/authenticated grants would survive a
-- `revoke ... from public` and leave SECURITY DEFINER functions callable.
--
-- Against the live project this is a no-op: default privileges only affect
-- objects created afterwards.
--
-- Note for whoever pushes this: this file, 00231_subscriptions.sql and
-- 00591_increment_counter_id_type.sql all sort before migrations the live project
-- has already applied, so `supabase db push` will report them as out of order and
-- ask for --include-all. That is safe here, and only here: this file only touches
-- default privileges, 00591 has no statements left, and 00231 creates its trigger
-- function only when absent. Most of the other 72 migrations are not re-appliable
-- (bare `create policy`, publication adds), so do not reach for --include-all as
-- a habit.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    return;
  end if;

  execute 'grant usage on schema public to anon, authenticated, service_role';
  execute 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role';
  execute 'alter default privileges in schema public grant all on sequences to anon, authenticated, service_role';
end;
$$;

-- Pin public.apply_increments to invoker rights and keep it off the browser roles.
--
-- The function builds and executes `update public.%I set %I = coalesce(%I,0) + %L`
-- from a caller-supplied table name and jsonb of column/delta pairs. Identifiers
-- go through %I so there is no injection, but the *target* is entirely the
-- caller's choice, which makes the function an arbitrary numeric-column update
-- primitive. 0001 defines it with invoker rights, so RLS still applies and it is
-- harmless there.
--
-- `scripts/0002_security_and_storage.sql` — a hand-applied file that was never
-- part of the migration chain, headed "Applied: 2026-04-17" — redefines the same
-- function with `security definer`. Under definer rights it runs as the owner and
-- bypasses RLS entirely, so any client holding the default PUBLIC execute grant
-- could raise its own cred_balance or anyone's follower count with a single
-- rpc('apply_increments', { p_table: 'users', p_id: ..., p_delta: ... }) call.
--
-- Restate the safe definition so a database carrying the definer version
-- converges on it, and revoke execute from the browser roles: nothing in the
-- application calls this (increment_counter, added in 0004 and retyped in 00591,
-- is what the counter paths actually use), so a caller appearing later should
-- fail loudly rather than inherit owner rights. search_path stays pinned, which
-- is the one improvement the hand-applied version made.

create or replace function public.apply_increments(
    p_table text,
    p_id    text,
    p_delta jsonb   -- {"likes": 1, "boosts": -2}
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    col text;
    val numeric;
    sets text := '';
begin
    for col, val in select key, (value::text)::numeric from jsonb_each_text(p_delta) loop
        sets := sets || format('%I = coalesce(%I,0) + %L, ', col, col, val);
    end loop;

    if length(sets) = 0 then
        return;
    end if;

    execute format(
        'update public.%I set %s updated_at = now() where id = %L',
        p_table, rtrim(sets, ', '), p_id
    );
end;
$$;

revoke all on function public.apply_increments(text, text, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.apply_increments(text, text, jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.apply_increments(text, text, jsonb) from authenticated;
  end if;
end;
$$;

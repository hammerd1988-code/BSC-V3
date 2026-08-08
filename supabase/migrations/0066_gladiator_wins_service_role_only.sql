-- increment_gladiator_wins is only ever called by the server (botMayhemAutonomy),
-- but 0063 granted it to `authenticated` and the function performs no ownership
-- check, so any signed-in account could inflate any gladiator's win count — the
-- number the Colosseum rankings are built from.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.increment_gladiator_wins(text) from authenticated;
  end if;
end;
$$;

revoke all on function public.increment_gladiator_wins(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.increment_gladiator_wins(text) to service_role;
  end if;
end;
$$;

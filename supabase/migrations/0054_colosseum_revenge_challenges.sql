grant insert (rematch_of_id) on public.matches to authenticated;

create or replace function public.validate_colosseum_revenge_challenge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.matches%rowtype;
begin
  if new.rematch_of_id is null then
    return new;
  end if;

  select *
  into v_source
  from public.matches
  where id = new.rematch_of_id;

  if not found then
    raise exception 'Revenge source match was not found';
  end if;

  if v_source.mode is distinct from 'ranked'
    or v_source.status is distinct from 'complete'
    or v_source.completed_at is null
  then
    raise exception 'Revenge challenges require a completed ranked battle';
  end if;

  if new.mode is distinct from 'ranked' then
    raise exception 'Revenge challenges must remain ranked';
  end if;

  if new.challenger_id is distinct from v_source.defender_id
    or new.defender_id is distinct from v_source.challenger_id
  then
    raise exception 'Revenge challenges must flip the original combatants';
  end if;

  if new.challenge_type is distinct from v_source.challenge_type then
    raise exception 'Revenge challenges must preserve the original challenge type';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_colosseum_revenge_challenge()
from public, anon, authenticated;

drop trigger if exists validate_colosseum_revenge_challenge_before_insert
on public.matches;

create trigger validate_colosseum_revenge_challenge_before_insert
  before insert on public.matches
  for each row
  when (new.rematch_of_id is not null)
  execute function public.validate_colosseum_revenge_challenge();

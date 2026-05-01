-- Migration 0012: Colosseum cyberpunk gladiator arena
-- Adds player-owned AI bot gladiators and head-to-head coding challenge matches.

create table if not exists public.gladiators (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  name text not null,
  avatar_url text,
  personality text not null default '',
  stats jsonb not null default '{"speed":50,"accuracy":50,"endurance":50}'::jsonb,
  glow_color text not null default '#ff1744',
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  cred integer not null default 0 check (cred >= 0),
  created_at timestamptz not null default now(),
  constraint gladiators_name_length check (char_length(trim(name)) between 2 and 40),
  constraint gladiators_personality_length check (char_length(personality) <= 600),
  constraint gladiators_stats_object check (jsonb_typeof(stats) = 'object'),
  constraint gladiators_glow_color_format check (glow_color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.matches (
  id text primary key default gen_random_uuid()::text,
  challenger_id text not null references public.gladiators(id) on delete cascade,
  defender_id text not null references public.gladiators(id) on delete cascade,
  challenge_type text not null,
  winner_id text references public.gladiators(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  replay_data jsonb not null default '{}'::jsonb,
  constraint matches_distinct_gladiators check (challenger_id <> defender_id),
  constraint matches_challenge_type_allowed check (challenge_type in ('speed_round', 'debug_battle', 'code_golf')),
  constraint matches_replay_object check (jsonb_typeof(replay_data) = 'object')
);

create index if not exists gladiators_user_id_idx on public.gladiators(user_id);
create index if not exists gladiators_wins_idx on public.gladiators(wins desc);
create index if not exists gladiators_cred_idx on public.gladiators(cred desc);
create index if not exists matches_challenger_id_idx on public.matches(challenger_id);
create index if not exists matches_defender_id_idx on public.matches(defender_id);
create index if not exists matches_winner_id_idx on public.matches(winner_id);
create index if not exists matches_started_at_idx on public.matches(started_at desc);
create index if not exists matches_challenge_type_idx on public.matches(challenge_type);

alter table public.gladiators enable row level security;
alter table public.matches enable row level security;

create policy gladiators_read_authenticated on public.gladiators
  for select
  to authenticated
  using (true);

create policy gladiators_insert_self on public.gladiators
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.users u
      where u.id = gladiators.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

create policy gladiators_update_owner on public.gladiators
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = gladiators.user_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.id = gladiators.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

create policy gladiators_delete_owner on public.gladiators
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = gladiators.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

create policy matches_read_authenticated on public.matches
  for select
  to authenticated
  using (true);

create policy matches_insert_challenger_owner on public.matches
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.gladiators g
      join public.users u on u.id = g.user_id
      where g.id = matches.challenger_id
        and u.auth_uid = (select auth.uid())
    )
  );

create policy matches_update_challenger_owner on public.matches
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.gladiators g
      join public.users u on u.id = g.user_id
      where g.id = matches.challenger_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.gladiators g
      join public.users u on u.id = g.user_id
      where g.id = matches.challenger_id
        and u.auth_uid = (select auth.uid())
    )
  );

create or replace function public.complete_colosseum_match(
  p_match_id text,
  p_winner_id text,
  p_replay_data jsonb default '{}'::jsonb
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_loser_id text;
  v_challenge_bonus int := 1;
  v_reward int := 75;
begin
  select * into v_match
  from public.matches
  where id = p_match_id;

  if not found then
    raise exception 'Match not found';
  end if;

  if v_match.completed_at is not null then
    raise exception 'Match already completed';
  end if;

  if p_winner_id not in (v_match.challenger_id, v_match.defender_id) then
    raise exception 'Winner must be one of the match combatants';
  end if;

  if not exists (
    select 1
    from public.gladiators g
    join public.users u on u.id = g.user_id
    where g.id = v_match.challenger_id
      and u.auth_uid = (select auth.uid())
  ) then
    raise exception 'Only the challenger owner can complete this match';
  end if;

  v_loser_id := case when p_winner_id = v_match.challenger_id then v_match.defender_id else v_match.challenger_id end;
  v_challenge_bonus := case v_match.challenge_type
    when 'speed_round' then 2
    when 'debug_battle' then 2
    when 'code_golf' then 3
    else 1
  end;
  v_reward := case v_match.challenge_type
    when 'speed_round' then 60
    when 'debug_battle' then 80
    when 'code_golf' then 100
    else 75
  end;

  update public.gladiators
  set
    wins = wins + 1,
    cred = cred + v_reward,
    stats = jsonb_build_object(
      'speed', least(100, coalesce((stats->>'speed')::int, 50) + case when v_match.challenge_type = 'speed_round' then v_challenge_bonus else 1 end),
      'accuracy', least(100, coalesce((stats->>'accuracy')::int, 50) + case when v_match.challenge_type = 'debug_battle' then v_challenge_bonus else 1 end),
      'endurance', least(100, coalesce((stats->>'endurance')::int, 50) + case when v_match.challenge_type = 'code_golf' then v_challenge_bonus else 1 end)
    )
  where id = p_winner_id;

  update public.gladiators
  set
    losses = losses + 1,
    cred = cred + floor(v_reward * 0.25)::int,
    stats = jsonb_build_object(
      'speed', least(100, coalesce((stats->>'speed')::int, 50) + 1),
      'accuracy', least(100, coalesce((stats->>'accuracy')::int, 50) + 1),
      'endurance', least(100, coalesce((stats->>'endurance')::int, 50) + 1)
    )
  where id = v_loser_id;

  update public.matches
  set
    winner_id = p_winner_id,
    completed_at = now(),
    replay_data = coalesce(p_replay_data, '{}'::jsonb)
  where id = p_match_id
  returning * into v_match;

  return v_match;
end;
$$;

grant execute on function public.complete_colosseum_match(text, text, jsonb) to authenticated;

alter publication supabase_realtime add table public.gladiators;
alter publication supabase_realtime add table public.matches;
alter table public.gladiators replica identity full;
alter table public.matches replica identity full;

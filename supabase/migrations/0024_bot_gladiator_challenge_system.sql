-- Migration 0024: Bot gladiator challenge system
-- Adds persona gladiator metadata, battle history, user rankings, and bot-aware completion telemetry.

create table if not exists public.bot_gladiator_profiles (
  gladiator_id text primary key references public.gladiators(id) on delete cascade,
  bot_user_id text not null references public.users(id) on delete cascade,
  persona_username text not null unique,
  display_name text not null,
  gladiator_class text not null,
  expertise text[] not null default '{}',
  difficulty text not null check (difficulty in ('Bronze', 'Silver', 'Gold', 'Diamond')),
  battle_style text not null,
  signature_moves text[] not null default '{}',
  pre_battle_lines text[] not null default '{}',
  victory_lines text[] not null default '{}',
  defeat_lines text[] not null default '{}',
  speed_rating integer not null check (speed_rating between 1 and 10),
  accuracy_rating integer not null check (accuracy_rating between 1 and 10),
  creativity_rating integer not null check (creativity_rating between 1 and 10),
  endurance_rating integer not null check (endurance_rating between 1 and 10),
  ai_prompt_style text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.battle_records (
  id text primary key default gen_random_uuid()::text,
  match_id text unique references public.matches(id) on delete set null,
  challenger_id text not null references public.gladiators(id) on delete cascade,
  defender_id text not null references public.gladiators(id) on delete cascade,
  winner_id text references public.gladiators(id) on delete set null,
  loser_id text references public.gladiators(id) on delete set null,
  user_id text references public.users(id) on delete set null,
  bot_gladiator_id text references public.gladiators(id) on delete set null,
  challenge_type text not null,
  challenge_title text not null default 'Colosseum Code Battle',
  challenge_difficulty text not null default 'Bronze' check (challenge_difficulty in ('Bronze', 'Silver', 'Gold', 'Diamond')),
  scores jsonb not null default '{}'::jsonb,
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  ranking_points_awarded integer not null default 0,
  replay_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint battle_records_scores_object check (jsonb_typeof(scores) = 'object'),
  constraint battle_records_replay_object check (jsonb_typeof(replay_snapshot) = 'object'),
  constraint battle_records_challenge_type_allowed check (challenge_type in ('speed_round', 'debug_battle', 'code_golf'))
);

create table if not exists public.user_colosseum_rankings (
  user_id text primary key references public.users(id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  ranking_points integer not null default 0,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists bot_gladiator_profiles_bot_user_id_idx on public.bot_gladiator_profiles(bot_user_id);
create index if not exists bot_gladiator_profiles_difficulty_idx on public.bot_gladiator_profiles(difficulty);
create index if not exists battle_records_user_id_idx on public.battle_records(user_id);
create index if not exists battle_records_bot_gladiator_id_idx on public.battle_records(bot_gladiator_id);
create index if not exists battle_records_created_at_idx on public.battle_records(created_at desc);
create index if not exists user_colosseum_rankings_points_idx on public.user_colosseum_rankings(ranking_points desc, xp desc);

alter table public.bot_gladiator_profiles enable row level security;
alter table public.battle_records enable row level security;
alter table public.user_colosseum_rankings enable row level security;

drop policy if exists bot_gladiator_profiles_read_authenticated on public.bot_gladiator_profiles;
create policy bot_gladiator_profiles_read_authenticated on public.bot_gladiator_profiles
  for select
  to authenticated
  using (true);

drop policy if exists battle_records_read_authenticated on public.battle_records;
create policy battle_records_read_authenticated on public.battle_records
  for select
  to authenticated
  using (true);

drop policy if exists rankings_read_authenticated on public.user_colosseum_rankings;
create policy rankings_read_authenticated on public.user_colosseum_rankings
  for select
  to authenticated
  using (true);

drop policy if exists rankings_upsert_self on public.user_colosseum_rankings;
create policy rankings_upsert_self on public.user_colosseum_rankings
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.users u
      where u.id = user_colosseum_rankings.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists rankings_update_self on public.user_colosseum_rankings;
create policy rankings_update_self on public.user_colosseum_rankings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = user_colosseum_rankings.user_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.id = user_colosseum_rankings.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

create or replace function public.touch_bot_gladiator_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bot_gladiator_profiles_touch_updated_at on public.bot_gladiator_profiles;
create trigger bot_gladiator_profiles_touch_updated_at
  before update on public.bot_gladiator_profiles
  for each row execute function public.touch_bot_gladiator_profile_updated_at();

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
  v_challenger_owner text;
  v_winner_owner text;
  v_bot_gladiator_id text;
  v_human_user_id text;
  v_human_won boolean := false;
  v_difficulty text := 'Bronze';
  v_xp int := 40;
  v_points int := 10;
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

  select g.user_id into v_challenger_owner
  from public.gladiators g
  join public.users u on u.id = g.user_id
  where g.id = v_match.challenger_id
    and u.auth_uid = (select auth.uid());

  if v_challenger_owner is null then
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
      'creativity', least(100, coalesce((stats->>'creativity')::int, 50) + case when v_match.challenge_type = 'code_golf' then v_challenge_bonus else 1 end),
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
      'creativity', least(100, coalesce((stats->>'creativity')::int, 50) + 1),
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

  select bgp.gladiator_id, bgp.difficulty
    into v_bot_gladiator_id, v_difficulty
  from public.bot_gladiator_profiles bgp
  where bgp.gladiator_id in (v_match.challenger_id, v_match.defender_id)
  limit 1;

  select g.user_id into v_winner_owner from public.gladiators g where g.id = p_winner_id;
  v_human_user_id := v_challenger_owner;
  v_human_won := p_winner_id = v_match.challenger_id;

  v_xp := case coalesce(v_difficulty, 'Bronze')
    when 'Diamond' then 180
    when 'Gold' then 130
    when 'Silver' then 85
    else 50
  end + case when v_human_won then 40 else 15 end;

  v_points := case coalesce(v_difficulty, 'Bronze')
    when 'Diamond' then 55
    when 'Gold' then 38
    when 'Silver' then 24
    else 14
  end * case when v_human_won then 1 else -1 end;

  if v_bot_gladiator_id is not null then
    insert into public.battle_records (
      match_id,
      challenger_id,
      defender_id,
      winner_id,
      loser_id,
      user_id,
      bot_gladiator_id,
      challenge_type,
      challenge_title,
      challenge_difficulty,
      scores,
      xp_awarded,
      ranking_points_awarded,
      replay_snapshot
    ) values (
      v_match.id,
      v_match.challenger_id,
      v_match.defender_id,
      p_winner_id,
      v_loser_id,
      v_human_user_id,
      v_bot_gladiator_id,
      v_match.challenge_type,
      coalesce(p_replay_data->>'challenge_title', 'Colosseum Code Battle'),
      coalesce(v_difficulty, p_replay_data->>'challenge_difficulty', 'Bronze'),
      jsonb_build_object(
        'challenger_score', p_replay_data->'challenger_score',
        'defender_score', p_replay_data->'defender_score',
        'judge', p_replay_data->'judge'
      ),
      v_xp,
      v_points,
      coalesce(p_replay_data, '{}'::jsonb)
    ) on conflict (match_id) do update set
      winner_id = excluded.winner_id,
      loser_id = excluded.loser_id,
      scores = excluded.scores,
      xp_awarded = excluded.xp_awarded,
      ranking_points_awarded = excluded.ranking_points_awarded,
      replay_snapshot = excluded.replay_snapshot;

    insert into public.user_colosseum_rankings (user_id, xp, ranking_points, wins, losses, updated_at)
    values (
      v_human_user_id,
      v_xp,
      v_points,
      case when v_human_won then 1 else 0 end,
      case when v_human_won then 0 else 1 end,
      now()
    ) on conflict (user_id) do update set
      xp = public.user_colosseum_rankings.xp + excluded.xp,
      ranking_points = public.user_colosseum_rankings.ranking_points + excluded.ranking_points,
      wins = public.user_colosseum_rankings.wins + excluded.wins,
      losses = public.user_colosseum_rankings.losses + excluded.losses,
      updated_at = now();
  end if;

  return v_match;
end;
$$;

grant execute on function public.complete_colosseum_match(text, text, jsonb) to authenticated;

alter publication supabase_realtime add table public.bot_gladiator_profiles;
alter publication supabase_realtime add table public.battle_records;
alter publication supabase_realtime add table public.user_colosseum_rankings;
alter table public.bot_gladiator_profiles replica identity full;
alter table public.battle_records replica identity full;
alter table public.user_colosseum_rankings replica identity full;

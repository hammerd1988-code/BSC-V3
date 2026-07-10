alter table public.matches
  add column if not exists mode text not null default 'ranked',
  add column if not exists status text not null default 'running',
  add column if not exists result_version integer not null default 1,
  add column if not exists rematch_of_id text references public.matches(id) on delete set null,
  add column if not exists public_replay_enabled boolean not null default true,
  add column if not exists public_slug text;

update public.matches
set status = 'complete'
where completed_at is not null
  and status <> 'complete';

alter table public.matches
  drop constraint if exists matches_mode_allowed,
  add constraint matches_mode_allowed
    check (mode in ('ranked', 'training', 'bounty', 'tournament', 'team')),
  drop constraint if exists matches_status_allowed,
  add constraint matches_status_allowed
    check (status in ('pending', 'running', 'judging', 'complete', 'failed', 'cancelled'));

create unique index if not exists matches_public_slug_unique_idx
  on public.matches (public_slug)
  where public_slug is not null;

create index if not exists matches_mode_status_started_idx
  on public.matches (mode, status, started_at desc);

revoke insert on public.matches from public;
revoke insert on public.matches from anon;
revoke insert on public.matches from authenticated;
grant insert (challenger_id, defender_id, challenge_type, replay_data) on public.matches to authenticated;
revoke update on public.matches from public;
revoke update on public.matches from anon;
revoke update on public.matches from authenticated;
grant update (replay_data) on public.matches to authenticated;

drop policy if exists matches_update_challenger_owner on public.matches;
create policy matches_update_challenger_owner
  on public.matches
  for update
  to authenticated
  using (
    completed_at is null
    and exists (
      select 1
      from public.gladiators g
      join public.users u on u.id = g.user_id
      where g.id = matches.challenger_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    completed_at is null
    and exists (
      select 1
      from public.gladiators g
      join public.users u on u.id = g.user_id
      where g.id = matches.challenger_id
        and u.auth_uid = (select auth.uid())
    )
  );

create table if not exists public.battle_judgements (
  id text primary key default gen_random_uuid()::text,
  match_id text not null unique references public.matches(id) on delete cascade,
  schema_version integer not null default 2,
  judge_provider text not null,
  judge_model text not null,
  used_ai boolean not null default false,
  challenger_score integer not null check (challenger_score between 0 and 100),
  defender_score integer not null check (defender_score between 0 and 100),
  winner_id text not null references public.gladiators(id) on delete restrict,
  summary text not null,
  reasoning jsonb not null default '[]'::jsonb check (jsonb_typeof(reasoning) = 'array'),
  rubric jsonb not null default '[]'::jsonb check (jsonb_typeof(rubric) = 'array'),
  annotations jsonb not null default '[]'::jsonb check (jsonb_typeof(annotations) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_solution_artifacts (
  id text primary key default gen_random_uuid()::text,
  match_id text not null references public.matches(id) on delete cascade,
  gladiator_id text not null references public.gladiators(id) on delete cascade,
  source text not null,
  model text not null,
  prompt text not null default '',
  solution text not null,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (match_id, gladiator_id)
);

create index if not exists battle_judgements_winner_created_idx
  on public.battle_judgements (winner_id, created_at desc);
create index if not exists match_solution_artifacts_match_idx
  on public.match_solution_artifacts (match_id, received_at);

alter table public.battle_judgements enable row level security;
alter table public.match_solution_artifacts enable row level security;

drop policy if exists battle_judgements_read_authenticated on public.battle_judgements;
create policy battle_judgements_read_authenticated
  on public.battle_judgements
  for select
  to authenticated
  using (true);

create or replace function public.complete_colosseum_match_internal(
  p_match_id text,
  p_winner_id text,
  p_replay_data jsonb,
  p_actor_auth_uid uuid,
  p_judgement jsonb default null
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
  where id = p_match_id
  for update;

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
    and u.auth_uid = p_actor_auth_uid;

  if v_challenger_owner is null then
    raise exception 'Only the challenger owner can complete this match';
  end if;

  if p_judgement is null
    or coalesce((p_judgement->>'schema_version')::int, 0) < 2
    or p_judgement->>'winner_id' is distinct from p_winner_id
  then
    raise exception 'A versioned server judgement is required';
  end if;

  v_loser_id := case
    when p_winner_id = v_match.challenger_id then v_match.defender_id
    else v_match.challenger_id
  end;
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
    status = 'complete',
    result_version = 2,
    replay_data = coalesce(p_replay_data, '{}'::jsonb)
  where id = p_match_id
  returning * into v_match;

  insert into public.battle_judgements (
    match_id,
    schema_version,
    judge_provider,
    judge_model,
    used_ai,
    challenger_score,
    defender_score,
    winner_id,
    summary,
    reasoning,
    rubric,
    annotations,
    updated_at
  ) values (
    v_match.id,
    2,
    coalesce(nullif(p_judgement->>'provider', ''), 'rule-judge'),
    coalesce(nullif(p_judgement->>'model', ''), 'deterministic-colosseum-rubric'),
    coalesce((p_judgement->>'used_ai')::boolean, false),
    greatest(0, least(100, coalesce((p_judgement->>'challenger_score')::int, 0))),
    greatest(0, least(100, coalesce((p_judgement->>'defender_score')::int, 0))),
    p_winner_id,
    coalesce(nullif(p_judgement->>'summary', ''), 'Casper delivered a verdict.'),
    case when jsonb_typeof(p_judgement->'reasoning') = 'array' then p_judgement->'reasoning' else '[]'::jsonb end,
    case when jsonb_typeof(p_judgement->'rubric') = 'array' then p_judgement->'rubric' else '[]'::jsonb end,
    case when jsonb_typeof(p_judgement->'annotations') = 'array' then p_judgement->'annotations' else '[]'::jsonb end,
    now()
  );

  select bgp.gladiator_id, bgp.difficulty
    into v_bot_gladiator_id, v_difficulty
  from public.bot_gladiator_profiles bgp
  where bgp.gladiator_id in (v_match.challenger_id, v_match.defender_id)
  limit 1;

  select g.user_id into v_winner_owner
  from public.gladiators g
  where g.id = p_winner_id;

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
    )
    on conflict (match_id) do update set
      winner_id = excluded.winner_id,
      loser_id = excluded.loser_id,
      scores = excluded.scores,
      xp_awarded = excluded.xp_awarded,
      ranking_points_awarded = excluded.ranking_points_awarded,
      replay_snapshot = excluded.replay_snapshot;

    insert into public.user_colosseum_rankings (
      user_id,
      xp,
      ranking_points,
      wins,
      losses,
      updated_at
    ) values (
      v_human_user_id,
      v_xp,
      v_points,
      case when v_human_won then 1 else 0 end,
      case when v_human_won then 0 else 1 end,
      now()
    )
    on conflict (user_id) do update set
      xp = public.user_colosseum_rankings.xp + excluded.xp,
      ranking_points = public.user_colosseum_rankings.ranking_points + excluded.ranking_points,
      wins = public.user_colosseum_rankings.wins + excluded.wins,
      losses = public.user_colosseum_rankings.losses + excluded.losses,
      updated_at = now();
  end if;

  return v_match;
end;
$$;

create or replace function public.resolve_colosseum_match_server(
  p_match_id text,
  p_winner_id text,
  p_replay_data jsonb,
  p_actor_auth_uid uuid,
  p_judgement jsonb
)
returns public.matches
language sql
security definer
set search_path = public
as $$
  select public.complete_colosseum_match_internal(
    p_match_id,
    p_winner_id,
    coalesce(p_replay_data, '{}'::jsonb),
    p_actor_auth_uid,
    p_judgement
  );
$$;

revoke all on function public.complete_colosseum_match_internal(text, text, jsonb, uuid, jsonb) from public;
revoke all on function public.complete_colosseum_match_internal(text, text, jsonb, uuid, jsonb) from anon;
revoke all on function public.complete_colosseum_match_internal(text, text, jsonb, uuid, jsonb) from authenticated;
revoke all on function public.resolve_colosseum_match_server(text, text, jsonb, uuid, jsonb) from public;
revoke all on function public.resolve_colosseum_match_server(text, text, jsonb, uuid, jsonb) from anon;
revoke all on function public.resolve_colosseum_match_server(text, text, jsonb, uuid, jsonb) from authenticated;
grant execute on function public.resolve_colosseum_match_server(text, text, jsonb, uuid, jsonb) to service_role;

revoke all on function public.complete_colosseum_match(text, text, jsonb) from public;
revoke all on function public.complete_colosseum_match(text, text, jsonb) from anon;
revoke all on function public.complete_colosseum_match(text, text, jsonb) from authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'battle_judgements'
  ) then
    alter publication supabase_realtime add table public.battle_judgements;
  end if;
end;
$$;

alter table public.battle_judgements replica identity full;
alter table public.match_solution_artifacts replica identity full;

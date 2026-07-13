create table if not exists public.gladiator_legacies (
  gladiator_id text primary key references public.gladiators(id) on delete cascade,
  ranked_battles integer not null default 0 check (ranked_battles >= 0),
  ranked_wins integer not null default 0 check (ranked_wins >= 0),
  ranked_losses integer not null default 0 check (ranked_losses >= 0),
  speed_wins integer not null default 0 check (speed_wins >= 0),
  debug_wins integer not null default 0 check (debug_wins >= 0),
  golf_wins integer not null default 0 check (golf_wins >= 0),
  evolving_signature text not null default 'Unblooded',
  last_match_id text references public.matches(id) on delete set null,
  first_fought_at timestamptz not null default now(),
  last_fought_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gladiator_legacies_record_consistent
    check (ranked_battles = ranked_wins + ranked_losses)
);

create table if not exists public.gladiator_battle_scars (
  id text primary key default gen_random_uuid()::text,
  gladiator_id text not null references public.gladiators(id) on delete cascade,
  scar_type text not null check (
    scar_type in ('first_blood', 'comeback_crown', 'giant_slayer', 'iron_tempered', 'flawless_code')
  ),
  earned_match_id text references public.matches(id) on delete set null,
  earned_at timestamptz not null default now(),
  scar_data jsonb not null default '{}'::jsonb,
  unique (gladiator_id, scar_type)
);

create index if not exists gladiator_battle_scars_gladiator_idx
  on public.gladiator_battle_scars (gladiator_id, earned_at desc);

alter table public.gladiator_legacies enable row level security;
alter table public.gladiator_battle_scars enable row level security;

revoke all on public.gladiator_legacies from public, anon, authenticated;
revoke all on public.gladiator_battle_scars from public, anon, authenticated;
grant select on public.gladiator_legacies to authenticated;
grant select on public.gladiator_battle_scars to authenticated;

drop policy if exists gladiator_legacies_read_authenticated on public.gladiator_legacies;
create policy gladiator_legacies_read_authenticated
  on public.gladiator_legacies
  for select
  to authenticated
  using (true);

drop policy if exists gladiator_battle_scars_read_authenticated on public.gladiator_battle_scars;
create policy gladiator_battle_scars_read_authenticated
  on public.gladiator_battle_scars
  for select
  to authenticated
  using (true);

create or replace function public.record_colosseum_battle_scars()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gladiator_id text;
  v_opponent_id text;
  v_result text;
  v_legacy public.gladiator_legacies%rowtype;
  v_owner_wins integer;
  v_opponent_wins integer;
  v_winner_score numeric;
  v_comeback boolean;
begin
  if old.completed_at is not null
    or new.completed_at is null
    or new.status is distinct from 'complete'
    or new.mode is distinct from 'ranked'
    or new.winner_id is null
    or new.winner_id not in (new.challenger_id, new.defender_id)
    or new.challenger_id = new.defender_id
  then
    return new;
  end if;

  for v_gladiator_id, v_opponent_id, v_result in
    select
      new.challenger_id,
      new.defender_id,
      case when new.winner_id = new.challenger_id then 'win' else 'loss' end
    union all
    select
      new.defender_id,
      new.challenger_id,
      case when new.winner_id = new.defender_id then 'win' else 'loss' end
  loop
    insert into public.gladiator_legacies (
      gladiator_id,
      ranked_battles,
      ranked_wins,
      ranked_losses,
      speed_wins,
      debug_wins,
      golf_wins,
      evolving_signature,
      last_match_id,
      first_fought_at,
      last_fought_at,
      updated_at
    )
    values (
      v_gladiator_id,
      1,
      case when v_result = 'win' then 1 else 0 end,
      case when v_result = 'loss' then 1 else 0 end,
      case when v_result = 'win' and new.challenge_type = 'speed_round' then 1 else 0 end,
      case when v_result = 'win' and new.challenge_type = 'debug_battle' then 1 else 0 end,
      case when v_result = 'win' and new.challenge_type = 'code_golf' then 1 else 0 end,
      case when v_result = 'win' then 'First Edge' else 'Unbroken Initiate' end,
      new.id,
      new.completed_at,
      new.completed_at,
      now()
    )
    on conflict (gladiator_id) do update set
      ranked_battles = public.gladiator_legacies.ranked_battles + 1,
      ranked_wins = public.gladiator_legacies.ranked_wins + case when v_result = 'win' then 1 else 0 end,
      ranked_losses = public.gladiator_legacies.ranked_losses + case when v_result = 'loss' then 1 else 0 end,
      speed_wins = public.gladiator_legacies.speed_wins + case when v_result = 'win' and new.challenge_type = 'speed_round' then 1 else 0 end,
      debug_wins = public.gladiator_legacies.debug_wins + case when v_result = 'win' and new.challenge_type = 'debug_battle' then 1 else 0 end,
      golf_wins = public.gladiator_legacies.golf_wins + case when v_result = 'win' and new.challenge_type = 'code_golf' then 1 else 0 end,
      last_match_id = new.id,
      last_fought_at = new.completed_at,
      updated_at = now();

    update public.gladiator_legacies
    set evolving_signature = case
      when ranked_battles >= 20 and ranked_wins * 100 >= ranked_battles * 75 then 'Arena Sovereign'
      when speed_wins >= 3 and speed_wins >= greatest(debug_wins, golf_wins) then 'Redline Executioner'
      when debug_wins >= 3 and debug_wins >= greatest(speed_wins, golf_wins) then 'Bug Eater'
      when golf_wins >= 3 and golf_wins >= greatest(speed_wins, debug_wins) then 'Byte Reaper'
      when ranked_wins >= 1 then 'Blooded Contender'
      else 'Unbroken Initiate'
    end
    where gladiator_id = v_gladiator_id
    returning * into v_legacy;

    if v_result = 'win' and v_legacy.ranked_wins = 1 then
      insert into public.gladiator_battle_scars (gladiator_id, scar_type, earned_match_id)
      values (v_gladiator_id, 'first_blood', new.id)
      on conflict (gladiator_id, scar_type) do nothing;
    end if;

    if v_legacy.ranked_battles = 10 then
      insert into public.gladiator_battle_scars (gladiator_id, scar_type, earned_match_id)
      values (v_gladiator_id, 'iron_tempered', new.id)
      on conflict (gladiator_id, scar_type) do nothing;
    end if;

    if v_result = 'win' then
      select coalesce(wins, 0)
      into v_owner_wins
      from public.gladiators
      where id = v_gladiator_id;

      select coalesce(wins, 0)
      into v_opponent_wins
      from public.gladiators
      where id = v_opponent_id;

      if v_opponent_wins >= v_owner_wins + 10 then
        insert into public.gladiator_battle_scars (
          gladiator_id,
          scar_type,
          earned_match_id,
          scar_data
        )
        values (
          v_gladiator_id,
          'giant_slayer',
          new.id,
          jsonb_build_object('opponent_id', v_opponent_id, 'win_gap', v_opponent_wins - v_owner_wins)
        )
        on conflict (gladiator_id, scar_type) do nothing;
      end if;

      v_winner_score := case
        when v_gladiator_id = new.challenger_id
          then nullif(new.replay_data #>> '{judge,challenger_score}', '')::numeric
        else nullif(new.replay_data #>> '{judge,defender_score}', '')::numeric
      end;

      if coalesce(v_winner_score, 0) >= 95 then
        insert into public.gladiator_battle_scars (
          gladiator_id,
          scar_type,
          earned_match_id,
          scar_data
        )
        values (
          v_gladiator_id,
          'flawless_code',
          new.id,
          jsonb_build_object('score', v_winner_score)
        )
        on conflict (gladiator_id, scar_type) do nothing;
      end if;

      select exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof(new.replay_data->'round_scores') = 'array'
              then new.replay_data->'round_scores'
            else '[]'::jsonb
          end
        ) round_score
        where case
          when v_gladiator_id = new.challenger_id
            then coalesce((round_score->>'challenger_score')::numeric, 0)
              < coalesce((round_score->>'defender_score')::numeric, 0)
          else coalesce((round_score->>'defender_score')::numeric, 0)
              < coalesce((round_score->>'challenger_score')::numeric, 0)
        end
      )
      into v_comeback;

      if v_comeback then
        insert into public.gladiator_battle_scars (gladiator_id, scar_type, earned_match_id)
        values (v_gladiator_id, 'comeback_crown', new.id)
        on conflict (gladiator_id, scar_type) do nothing;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.record_colosseum_battle_scars() from public, anon, authenticated;

drop trigger if exists record_colosseum_battle_scars_after_match on public.matches;
create trigger record_colosseum_battle_scars_after_match
  after update of winner_id, completed_at, status on public.matches
  for each row
  execute function public.record_colosseum_battle_scars();

with directional_matches as (
  select
    m.challenger_id as gladiator_id,
    case when m.winner_id = m.challenger_id then 'win' else 'loss' end as result,
    m.challenge_type,
    m.id as match_id,
    m.completed_at
  from public.matches m
  where m.mode = 'ranked'
    and m.status = 'complete'
    and m.completed_at is not null
    and m.winner_id in (m.challenger_id, m.defender_id)
    and m.challenger_id <> m.defender_id
  union all
  select
    m.defender_id,
    case when m.winner_id = m.defender_id then 'win' else 'loss' end,
    m.challenge_type,
    m.id,
    m.completed_at
  from public.matches m
  where m.mode = 'ranked'
    and m.status = 'complete'
    and m.completed_at is not null
    and m.winner_id in (m.challenger_id, m.defender_id)
    and m.challenger_id <> m.defender_id
),
legacy_summaries as (
  select
    gladiator_id,
    count(*)::integer as ranked_battles,
    count(*) filter (where result = 'win')::integer as ranked_wins,
    count(*) filter (where result = 'loss')::integer as ranked_losses,
    count(*) filter (where result = 'win' and challenge_type = 'speed_round')::integer as speed_wins,
    count(*) filter (where result = 'win' and challenge_type = 'debug_battle')::integer as debug_wins,
    count(*) filter (where result = 'win' and challenge_type = 'code_golf')::integer as golf_wins,
    (array_agg(match_id order by completed_at desc, match_id desc))[1] as last_match_id,
    min(completed_at) as first_fought_at,
    max(completed_at) as last_fought_at
  from directional_matches
  group by gladiator_id
)
insert into public.gladiator_legacies (
  gladiator_id,
  ranked_battles,
  ranked_wins,
  ranked_losses,
  speed_wins,
  debug_wins,
  golf_wins,
  evolving_signature,
  last_match_id,
  first_fought_at,
  last_fought_at,
  updated_at
)
select
  gladiator_id,
  ranked_battles,
  ranked_wins,
  ranked_losses,
  speed_wins,
  debug_wins,
  golf_wins,
  case
    when ranked_battles >= 20 and ranked_wins * 100 >= ranked_battles * 75 then 'Arena Sovereign'
    when speed_wins >= 3 and speed_wins >= greatest(debug_wins, golf_wins) then 'Redline Executioner'
    when debug_wins >= 3 and debug_wins >= greatest(speed_wins, golf_wins) then 'Bug Eater'
    when golf_wins >= 3 and golf_wins >= greatest(speed_wins, debug_wins) then 'Byte Reaper'
    when ranked_wins >= 1 then 'Blooded Contender'
    else 'Unbroken Initiate'
  end,
  last_match_id,
  first_fought_at,
  last_fought_at,
  last_fought_at
from legacy_summaries
on conflict (gladiator_id) do nothing;

with directional_matches as (
  select
    m.challenger_id as gladiator_id,
    case when m.winner_id = m.challenger_id then 'win' else 'loss' end as result,
    m.id as match_id,
    m.completed_at
  from public.matches m
  where m.mode = 'ranked'
    and m.status = 'complete'
    and m.completed_at is not null
    and m.winner_id in (m.challenger_id, m.defender_id)
    and m.challenger_id <> m.defender_id
  union all
  select
    m.defender_id,
    case when m.winner_id = m.defender_id then 'win' else 'loss' end,
    m.id,
    m.completed_at
  from public.matches m
  where m.mode = 'ranked'
    and m.status = 'complete'
    and m.completed_at is not null
    and m.winner_id in (m.challenger_id, m.defender_id)
    and m.challenger_id <> m.defender_id
),
ordered as (
  select
    directional_matches.*,
    row_number() over (
      partition by gladiator_id
      order by completed_at, match_id
    ) as battle_number,
    count(*) filter (where result = 'win') over (
      partition by gladiator_id
      order by completed_at, match_id
      rows between unbounded preceding and current row
    ) as win_number
  from directional_matches
)
insert into public.gladiator_battle_scars (
  gladiator_id,
  scar_type,
  earned_match_id,
  earned_at
)
select gladiator_id, 'first_blood', match_id, completed_at
from ordered
where result = 'win' and win_number = 1
union all
select gladiator_id, 'iron_tempered', match_id, completed_at
from ordered
where battle_number = 10
on conflict (gladiator_id, scar_type) do nothing;

alter table public.gladiator_legacies replica identity full;
alter table public.gladiator_battle_scars replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gladiator_legacies'
  ) then
    alter publication supabase_realtime add table public.gladiator_legacies;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gladiator_battle_scars'
  ) then
    alter publication supabase_realtime add table public.gladiator_battle_scars;
  end if;
end;
$$;

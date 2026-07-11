create table if not exists public.gladiator_rivalries (
  owner_gladiator_id text not null references public.gladiators(id) on delete cascade,
  rival_gladiator_id text not null references public.gladiators(id) on delete cascade,
  encounters integer not null default 0 check (encounters >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  current_streak integer not null default 0,
  best_win_streak integer not null default 0 check (best_win_streak >= 0),
  worst_loss_streak integer not null default 0 check (worst_loss_streak >= 0),
  grudge_score integer not null default 0 check (grudge_score between 0 and 100),
  last_result text not null default 'loss' check (last_result in ('win', 'loss')),
  last_match_id text references public.matches(id) on delete set null,
  last_challenge_type text,
  first_fought_at timestamptz not null default now(),
  last_fought_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_gladiator_id, rival_gladiator_id),
  constraint gladiator_rivalries_distinct_gladiators
    check (owner_gladiator_id <> rival_gladiator_id),
  constraint gladiator_rivalries_record_consistent
    check (encounters = wins + losses)
);

create index if not exists gladiator_rivalries_owner_heat_idx
  on public.gladiator_rivalries (owner_gladiator_id, grudge_score desc, last_fought_at desc);

create index if not exists gladiator_rivalries_rival_idx
  on public.gladiator_rivalries (rival_gladiator_id, last_fought_at desc);

alter table public.gladiator_rivalries enable row level security;

revoke all on public.gladiator_rivalries from public;
revoke all on public.gladiator_rivalries from anon;
revoke all on public.gladiator_rivalries from authenticated;
grant select on public.gladiator_rivalries to authenticated;

drop policy if exists gladiator_rivalries_read_owner on public.gladiator_rivalries;
create policy gladiator_rivalries_read_owner
  on public.gladiator_rivalries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.gladiators g
      join public.users u on u.id = g.user_id
      where g.id = gladiator_rivalries.owner_gladiator_id
        and u.auth_uid = (select auth.uid())
    )
  );

create or replace function public.record_colosseum_grudge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_rival text;
  v_result text;
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

  for v_owner, v_rival, v_result in
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
    insert into public.gladiator_rivalries (
      owner_gladiator_id,
      rival_gladiator_id,
      encounters,
      wins,
      losses,
      current_streak,
      best_win_streak,
      worst_loss_streak,
      grudge_score,
      last_result,
      last_match_id,
      last_challenge_type,
      first_fought_at,
      last_fought_at,
      updated_at
    ) values (
      v_owner,
      v_rival,
      1,
      case when v_result = 'win' then 1 else 0 end,
      case when v_result = 'loss' then 1 else 0 end,
      case when v_result = 'win' then 1 else -1 end,
      case when v_result = 'win' then 1 else 0 end,
      case when v_result = 'loss' then 1 else 0 end,
      case when v_result = 'loss' then 11 else 7 end,
      v_result,
      new.id,
      new.challenge_type,
      coalesce(new.completed_at, now()),
      coalesce(new.completed_at, now()),
      now()
    )
    on conflict (owner_gladiator_id, rival_gladiator_id) do update set
      encounters = public.gladiator_rivalries.encounters + 1,
      wins = public.gladiator_rivalries.wins + case when excluded.last_result = 'win' then 1 else 0 end,
      losses = public.gladiator_rivalries.losses + case when excluded.last_result = 'loss' then 1 else 0 end,
      current_streak = case
        when excluded.last_result = 'win'
          then greatest(public.gladiator_rivalries.current_streak, 0) + 1
        else least(public.gladiator_rivalries.current_streak, 0) - 1
      end,
      best_win_streak = greatest(
        public.gladiator_rivalries.best_win_streak,
        case
          when excluded.last_result = 'win'
            then greatest(public.gladiator_rivalries.current_streak, 0) + 1
          else 0
        end
      ),
      worst_loss_streak = greatest(
        public.gladiator_rivalries.worst_loss_streak,
        case
          when excluded.last_result = 'loss'
            then abs(least(public.gladiator_rivalries.current_streak, 0) - 1)
          else 0
        end
      ),
      grudge_score = least(
        100,
        public.gladiator_rivalries.grudge_score
          + case when excluded.last_result = 'loss' then 11 else 7 end
          + case when public.gladiator_rivalries.encounters in (2, 4, 9) then 5 else 0 end
      ),
      last_result = excluded.last_result,
      last_match_id = excluded.last_match_id,
      last_challenge_type = excluded.last_challenge_type,
      last_fought_at = excluded.last_fought_at,
      updated_at = now();
  end loop;

  return new;
end;
$$;

revoke all on function public.record_colosseum_grudge() from public;
revoke all on function public.record_colosseum_grudge() from anon;
revoke all on function public.record_colosseum_grudge() from authenticated;

drop trigger if exists record_colosseum_grudge_after_match on public.matches;
create trigger record_colosseum_grudge_after_match
  after update of winner_id, completed_at, status on public.matches
  for each row
  execute function public.record_colosseum_grudge();

with directional_matches as (
  select
    m.challenger_id as owner_gladiator_id,
    m.defender_id as rival_gladiator_id,
    case when m.winner_id = m.challenger_id then 'win' else 'loss' end as result,
    m.id as match_id,
    m.challenge_type,
    m.completed_at
  from public.matches m
  where m.mode = 'ranked'
    and m.status = 'complete'
    and m.completed_at is not null
    and m.winner_id is not null
    and m.winner_id in (m.challenger_id, m.defender_id)
    and m.challenger_id <> m.defender_id
  union all
  select
    m.defender_id,
    m.challenger_id,
    case when m.winner_id = m.defender_id then 'win' else 'loss' end,
    m.id,
    m.challenge_type,
    m.completed_at
  from public.matches m
  where m.mode = 'ranked'
    and m.status = 'complete'
    and m.completed_at is not null
    and m.winner_id is not null
    and m.winner_id in (m.challenger_id, m.defender_id)
    and m.challenger_id <> m.defender_id
),
summaries as (
  select
    owner_gladiator_id,
    rival_gladiator_id,
    count(*)::integer as encounters,
    count(*) filter (where result = 'win')::integer as wins,
    count(*) filter (where result = 'loss')::integer as losses,
    min(completed_at) as first_fought_at,
    max(completed_at) as last_fought_at,
    (array_agg(result order by completed_at desc, match_id desc))[1] as last_result,
    (array_agg(match_id order by completed_at desc, match_id desc))[1] as last_match_id,
    (array_agg(challenge_type order by completed_at desc, match_id desc))[1] as last_challenge_type
  from directional_matches
  group by owner_gladiator_id, rival_gladiator_id
)
insert into public.gladiator_rivalries (
  owner_gladiator_id,
  rival_gladiator_id,
  encounters,
  wins,
  losses,
  current_streak,
  best_win_streak,
  worst_loss_streak,
  grudge_score,
  last_result,
  last_match_id,
  last_challenge_type,
  first_fought_at,
  last_fought_at,
  updated_at
)
select
  owner_gladiator_id,
  rival_gladiator_id,
  encounters,
  wins,
  losses,
  case when last_result = 'win' then 1 else -1 end,
  case when wins > 0 then 1 else 0 end,
  case when losses > 0 then 1 else 0 end,
  least(100, encounters * 5 + losses * 3),
  last_result,
  last_match_id,
  last_challenge_type,
  first_fought_at,
  last_fought_at,
  now()
from summaries
on conflict (owner_gladiator_id, rival_gladiator_id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gladiator_rivalries'
  ) then
    alter publication supabase_realtime add table public.gladiator_rivalries;
  end if;
exception
  when undefined_object then null;
end
$$;

alter table public.gladiator_rivalries replica identity full;

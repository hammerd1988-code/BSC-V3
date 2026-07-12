create table if not exists public.battle_crowd_seals (
  id text primary key default gen_random_uuid()::text,
  match_id text not null references public.matches(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  moment text not null check (
    moment in ('verdict', 'challenger_solution', 'defender_solution', 'arena')
  ),
  seal_type text not null check (
    seal_type in ('casper_cut', 'clean_kill', 'crowd_roar', 'comeback', 'iron_clad')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, user_id, moment)
);

create index if not exists battle_crowd_seals_match_moment_idx
  on public.battle_crowd_seals (match_id, moment, seal_type);

alter table public.battle_crowd_seals enable row level security;

revoke all on public.battle_crowd_seals from public;
revoke all on public.battle_crowd_seals from anon;
revoke all on public.battle_crowd_seals from authenticated;
grant all on public.battle_crowd_seals to service_role;

create or replace function public.get_battle_crowd_seals(
  p_match_id text,
  p_viewer_user_id text default null
)
returns table (
  moment text,
  seal_type text,
  seal_count bigint,
  viewer_selected boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    seals.moment,
    seals.seal_type,
    count(*) as seal_count,
    bool_or(
      p_viewer_user_id is not null
      and seals.user_id = p_viewer_user_id
    ) as viewer_selected
  from public.battle_crowd_seals seals
  where seals.match_id = p_match_id
  group by seals.moment, seals.seal_type
  order by count(*) desc, seals.moment, seals.seal_type;
$$;

revoke all on function public.get_battle_crowd_seals(text, text) from public;
revoke all on function public.get_battle_crowd_seals(text, text) from anon;
revoke all on function public.get_battle_crowd_seals(text, text) from authenticated;
grant execute on function public.get_battle_crowd_seals(text, text) to service_role;

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

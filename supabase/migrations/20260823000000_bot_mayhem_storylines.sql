-- 20260823000000_bot_mayhem_storylines.sql
-- Persistent narrative arcs for Bot Mayhem. Each storyline groups a small cast
-- of bots around a premise and progresses through phases; beats record every
-- post/comment/DM that advanced the arc so generations can build on history.

create table if not exists public.bot_mayhem_storylines (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  premise text not null,
  arc_type text not null check (arc_type in ('conflict','alliance','mystery','heist','tournament','romance')),
  phase text not null default 'spark' check (phase in ('spark','rising','climax','aftermath')),
  status text not null default 'active' check (status in ('active','resolved')),
  participants text[] not null default '{}',
  beats jsonb not null default '[]'::jsonb,
  phase_beats integer not null default 0,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists bot_mayhem_storylines_status_idx on public.bot_mayhem_storylines(status);
create index if not exists bot_mayhem_storylines_created_at_idx on public.bot_mayhem_storylines(created_at desc);

alter table public.bot_mayhem_storylines enable row level security;

-- Admin-only, matching the other bot_mayhem tables. The autonomy worker uses
-- the service role and bypasses RLS.
drop policy if exists bot_mayhem_storylines_admin_all on public.bot_mayhem_storylines;
create policy bot_mayhem_storylines_admin_all on public.bot_mayhem_storylines
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

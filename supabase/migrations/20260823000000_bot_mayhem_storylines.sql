-- 20260823000000_bot_mayhem_storylines.sql
-- Persistent narrative arcs for Bot Mayhem. Each storyline groups a small cast
-- of bots around a premise and progresses through phases; beats record every
-- post/comment/DM that advanced the arc so generations can build on history.
--
-- created_by must match the type of public.users(id), which differs between
-- environments (uuid on the live project, text in the local-from-scratch
-- schema). The DO block below creates/converts the column to whichever type
-- users.id actually has before (re)creating the FK, so this migration is
-- idempotent and safe to paste into the SQL Editor or apply via db reset.

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

do $$
declare
  users_id_type text;
  created_by_type text;
begin
  select data_type into users_id_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'users' and column_name = 'id';

  select data_type into created_by_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'bot_mayhem_storylines' and column_name = 'created_by';

  if created_by_type is null then
    execute format('alter table public.bot_mayhem_storylines add column created_by %s', users_id_type);
  elsif created_by_type is distinct from users_id_type then
    execute 'alter table public.bot_mayhem_storylines drop constraint if exists bot_mayhem_storylines_created_by_fkey';
    execute format('alter table public.bot_mayhem_storylines alter column created_by type %s using created_by::%s', users_id_type, users_id_type);
  end if;

  execute 'alter table public.bot_mayhem_storylines drop constraint if exists bot_mayhem_storylines_created_by_fkey';
  execute 'alter table public.bot_mayhem_storylines
    add constraint bot_mayhem_storylines_created_by_fkey
    foreign key (created_by) references public.users(id) on delete set null';
end $$;

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

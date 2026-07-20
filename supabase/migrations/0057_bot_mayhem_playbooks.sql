-- 0057_bot_mayhem_playbooks.sql
-- Admin playbook console for Bot Mayhem: saved playbooks, run logs, and bot relationships.

create table if not exists public.bot_mayhem_playbooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  action text not null check (action in ('post','battle','react','alliance','rivalry','dm','combined')),
  filters jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_mayhem_runs (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid references public.bot_mayhem_playbooks(id) on delete set null,
  action text not null,
  filters jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  run_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.bot_mayhem_relationships (
  id uuid primary key default gen_random_uuid(),
  source_username text not null,
  target_username text not null,
  relationship_type text not null check (relationship_type in ('alliance','rivalry','neutral')),
  score integer not null default 0,
  sentiment text not null default 'neutral',
  notes text not null default '',
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_mayhem_relationships_unique_pair unique (source_username, target_username),
  constraint bot_mayhem_relationships_no_self check (source_username <> target_username)
);

create index if not exists bot_mayhem_playbooks_created_by_idx on public.bot_mayhem_playbooks(created_by);
create index if not exists bot_mayhem_runs_playbook_id_idx on public.bot_mayhem_runs(playbook_id);
create index if not exists bot_mayhem_runs_created_at_idx on public.bot_mayhem_runs(created_at desc);
create index if not exists bot_mayhem_relationships_source_idx on public.bot_mayhem_relationships(source_username);
create index if not exists bot_mayhem_relationships_target_idx on public.bot_mayhem_relationships(target_username);

alter table public.bot_mayhem_playbooks enable row level security;
alter table public.bot_mayhem_runs enable row level security;
alter table public.bot_mayhem_relationships enable row level security;

-- Admin-only helper. Service role bypasses RLS for the automation worker.
create or replace function public.is_admin_user()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where auth_uid = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists bot_mayhem_playbooks_admin_all on public.bot_mayhem_playbooks;
create policy bot_mayhem_playbooks_admin_all on public.bot_mayhem_playbooks
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists bot_mayhem_runs_admin_all on public.bot_mayhem_runs;
create policy bot_mayhem_runs_admin_all on public.bot_mayhem_runs
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists bot_mayhem_relationships_admin_all on public.bot_mayhem_relationships;
create policy bot_mayhem_relationships_admin_all on public.bot_mayhem_relationships
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

-- Realtime feed for live console logs
alter publication supabase_realtime add table public.bot_mayhem_runs;

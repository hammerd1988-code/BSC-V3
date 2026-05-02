-- =========================================================================
-- Casper agent management configuration, tasks, and activity log
-- =========================================================================

create extension if not exists "pgcrypto";

create table if not exists public.casper_config (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.casper_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  result text
);

create table if not exists public.casper_activity_log (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists casper_tasks_status_priority_idx on public.casper_tasks (status, priority, created_at desc);
create index if not exists casper_activity_log_created_idx on public.casper_activity_log (created_at desc);
create index if not exists casper_activity_log_action_idx on public.casper_activity_log (action_type, created_at desc);

insert into public.casper_config (key, value)
values (
  'schedule',
  '{"posting_frequency_hours":8,"quiet_hours":{"start":"23:00","end":"07:00"},"obligations":{"monitor_errors":true,"greet_new_users":true,"daily_digest":true,"check_comments":true},"capabilities":{"browser_access":false,"shell_access":false,"mcp_tools":false,"auto_reply_comments":true,"dm_notifications":true}}'::jsonb
)
on conflict (key) do nothing;

create or replace function public.touch_casper_config_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists casper_config_touch_updated_at on public.casper_config;
create trigger casper_config_touch_updated_at
before update on public.casper_config
for each row execute function public.touch_casper_config_updated_at();

alter table public.casper_config enable row level security;
alter table public.casper_tasks enable row level security;
alter table public.casper_activity_log enable row level security;

drop policy if exists casper_config_admin_read on public.casper_config;
create policy casper_config_admin_read on public.casper_config
  for select
  to authenticated
  using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_config_admin_write on public.casper_config;
create policy casper_config_admin_write on public.casper_config
  for all
  to authenticated
  using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  )
  with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_tasks_admin_read on public.casper_tasks;
create policy casper_tasks_admin_read on public.casper_tasks
  for select
  to authenticated
  using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_tasks_admin_write on public.casper_tasks;
create policy casper_tasks_admin_write on public.casper_tasks
  for all
  to authenticated
  using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  )
  with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_activity_log_admin_read on public.casper_activity_log;
create policy casper_activity_log_admin_read on public.casper_activity_log
  for select
  to authenticated
  using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_activity_log_admin_write on public.casper_activity_log;
create policy casper_activity_log_admin_write on public.casper_activity_log
  for all
  to authenticated
  using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  )
  with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

alter publication supabase_realtime add table public.casper_config;
alter publication supabase_realtime add table public.casper_tasks;
alter publication supabase_realtime add table public.casper_activity_log;
alter table public.casper_config replica identity full;
alter table public.casper_tasks replica identity full;
alter table public.casper_activity_log replica identity full;

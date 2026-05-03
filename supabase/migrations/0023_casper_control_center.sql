-- =========================================================================
-- Casper production agent control center: routines, skills, task telemetry,
-- user-safe policies, and persistent cognitive core configuration.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- Harden Casper memories to UUID primary keys while keeping user_id compatible
-- with the current text-backed public.users.id schema.
-- -------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'casper_memories'
      and column_name = 'id'
      and data_type = 'text'
  ) then
    alter table public.casper_memories alter column id drop default;
    alter table public.casper_memories alter column id type uuid using id::uuid;
    alter table public.casper_memories alter column id set default gen_random_uuid();
  end if;
exception
  when invalid_text_representation then
    raise notice 'casper_memories.id contains non-UUID text values; leaving existing type unchanged.';
end $$;

-- Keep the access RPC callable from existing TypeScript code that sends string ids.
create or replace function public.increment_memory_access(memory_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.casper_memories
  set access_count = coalesce(access_count, 0) + 1,
      last_accessed = now()
  where id::text = any(memory_ids);
end;
$$;

grant execute on function public.increment_memory_access(text[]) to authenticated;

-- -------------------------------------------------------------------------
-- Extend the existing task and activity tables for real execution telemetry.
-- -------------------------------------------------------------------------
alter table public.casper_tasks
  add column if not exists task_type text not null default 'mission',
  add column if not exists progress integer not null default 0,
  add column if not exists assigned_to uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'casper_tasks_progress_range') then
    alter table public.casper_tasks add constraint casper_tasks_progress_range check (progress between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'casper_tasks_type_allowed') then
    alter table public.casper_tasks add constraint casper_tasks_type_allowed check (task_type in ('mission','direct_command','routine','subagent','system'));
  end if;
end $$;

create index if not exists casper_tasks_created_by_idx on public.casper_tasks (created_by, created_at desc);
create index if not exists casper_tasks_type_status_idx on public.casper_tasks (task_type, status, created_at desc);

alter table public.casper_activity_log
  add column if not exists actor_id uuid,
  add column if not exists task_id uuid references public.casper_tasks(id) on delete set null;

create index if not exists casper_activity_log_actor_idx on public.casper_activity_log (actor_id, created_at desc);
create index if not exists casper_activity_log_task_idx on public.casper_activity_log (task_id, created_at desc);

-- -------------------------------------------------------------------------
-- First-class proactive scheduler.
-- -------------------------------------------------------------------------
create table if not exists public.casper_routines (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 140),
  directive text not null check (char_length(trim(directive)) between 2 and 4000),
  frequency text not null default 'daily' check (frequency in ('hourly','daily','weekly','cron','custom')),
  cron_expression text,
  scheduled_time time,
  scheduled_days integer[] not null default '{}'::integer[],
  timezone text not null default 'UTC',
  is_enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_result text,
  run_count integer not null default 0 check (run_count >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists casper_routines_enabled_next_idx on public.casper_routines (is_enabled, next_run_at);
create index if not exists casper_routines_created_by_idx on public.casper_routines (created_by, created_at desc);
create index if not exists casper_routines_frequency_idx on public.casper_routines (frequency, is_enabled);

-- -------------------------------------------------------------------------
-- Skill/tool registry for installable/configurable Casper capabilities.
-- -------------------------------------------------------------------------
create table if not exists public.casper_skills (
  id uuid primary key default gen_random_uuid(),
  skill_key text not null unique check (skill_key ~ '^[a-z0-9_:-]{2,80}$'),
  label text not null check (char_length(trim(label)) between 2 and 120),
  description text not null default '',
  category text not null default 'general',
  is_installed boolean not null default true,
  is_enabled boolean not null default true,
  permission_level text not null default 'admin' check (permission_level in ('admin','user','system')),
  config jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists casper_skills_category_idx on public.casper_skills (category, is_enabled);
create index if not exists casper_skills_permission_idx on public.casper_skills (permission_level, is_enabled);

-- -------------------------------------------------------------------------
-- User integration marketplace/API hub. API keys are stored in an encrypted or
-- encrypted-at-rest payload column by application/server code, never exposed in
-- full through the UI.
-- -------------------------------------------------------------------------
create table if not exists public.casper_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  integration_key text not null check (integration_key ~ '^[a-z0-9_:-]{2,80}$'),
  api_key_encrypted text,
  enabled boolean not null default false,
  status text not null default 'disconnected' check (status in ('connected','disconnected','error')),
  connected_at timestamptz,
  last_used_at timestamptz,
  error_message text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, integration_key)
);

create index if not exists casper_integrations_user_idx on public.casper_integrations (user_id, enabled, status);
create index if not exists casper_integrations_key_idx on public.casper_integrations (integration_key, enabled);

insert into public.casper_skills (skill_key, label, description, category, permission_level, config)
values
  ('memory.search', 'Memory Search', 'Search, inspect, and retrieve Casper conversation memories.', 'memory', 'user', '{"scopes":["casper_memories"]}'::jsonb),
  ('memory.manage', 'Memory Management', 'Delete low-value or obsolete Casper memories.', 'memory', 'admin', '{"scopes":["casper_memories:delete"]}'::jsonb),
  ('mission.queue', 'Mission Queue', 'Create, edit, run, and complete Casper tasks.', 'operations', 'user', '{"states":["pending","running","completed","failed"]}'::jsonb),
  ('routine.scheduler', 'Cron Scheduler', 'Schedule proactive Casper routines with hourly, daily, weekly, and cron-style triggers.', 'automation', 'user', '{"frequencies":["hourly","daily","weekly","cron","custom"]}'::jsonb),
  ('subagent.orchestration', 'Sub-Agent Orchestration', 'Track parallel sub-agent execution and cancellation status.', 'orchestration', 'admin', '{}'::jsonb),
  ('command.console', 'Operator Console', 'Execute direct Casper directives and persist command output.', 'operations', 'admin', '{}'::jsonb),
  ('social.monitor', 'Social Network Monitor', 'Monitor BSC social activity, replies, and network signals.', 'network', 'admin', '{}'::jsonb),
  ('content.studio', 'Content Studio Bridge', 'Connect Casper missions to posts, clips, streams, and generated media.', 'content', 'user', '{}'::jsonb),
  ('integration.marketplace', 'Integration Marketplace', 'Browse, connect, enable, and disable third-party API modules for Casper.', 'integrations', 'user', '{"categories":["Automation","Development","Communication","Content","Analytics","Deployment","AI Models"]}'::jsonb),
  ('integration.context', 'Integration-Aware Prompting', 'Inject connected integration capabilities into Casper command and chat context.', 'integrations', 'system', '{}'::jsonb)
on conflict (skill_key) do update set
  label = excluded.label,
  description = excluded.description,
  category = excluded.category,
  permission_level = excluded.permission_level,
  config = excluded.config,
  updated_at = now();

-- -------------------------------------------------------------------------
-- Persistent cognitive core defaults used by admin and user dashboards.
-- -------------------------------------------------------------------------
insert into public.casper_config (key, value)
values (
  'cognitive_core',
  '{
    "personality_traits": {
      "decisiveness": 72,
      "curiosity": 78,
      "warmth": 62,
      "caution": 42,
      "humor": 36,
      "autonomy": 58
    },
    "knowledge_domains": {
      "software_engineering": true,
      "business_strategy": true,
      "content_creation": true,
      "social_networking": true,
      "live_streaming": true,
      "colosseum_competition": true,
      "cybersecurity": false,
      "market_research": true
    },
    "response_style": {
      "tone": "cyberpunk strategic operator",
      "verbosity": "balanced",
      "format": "actionable markdown",
      "temperature": 0.55,
      "max_tokens": 900
    },
    "behavioral_parameters": {
      "confirm_before_destructive_actions": true,
      "proactive_suggestions": true,
      "store_conversation_memories": true,
      "use_network_context": true,
      "parallel_subagents": true,
      "actions_per_minute_target": 12,
      "agent_status": "idle"
    }
  }'::jsonb
)
on conflict (key) do nothing;

-- -------------------------------------------------------------------------
-- Touch triggers.
-- -------------------------------------------------------------------------
create or replace function public.touch_casper_control_center_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists casper_tasks_touch_updated_at on public.casper_tasks;
create trigger casper_tasks_touch_updated_at
before update on public.casper_tasks
for each row execute function public.touch_casper_control_center_updated_at();

drop trigger if exists casper_routines_touch_updated_at on public.casper_routines;
create trigger casper_routines_touch_updated_at
before update on public.casper_routines
for each row execute function public.touch_casper_control_center_updated_at();

drop trigger if exists casper_skills_touch_updated_at on public.casper_skills;
create trigger casper_skills_touch_updated_at
before update on public.casper_skills
for each row execute function public.touch_casper_control_center_updated_at();

drop trigger if exists casper_integrations_touch_updated_at on public.casper_integrations;
create trigger casper_integrations_touch_updated_at
before update on public.casper_integrations
for each row execute function public.touch_casper_control_center_updated_at();

-- -------------------------------------------------------------------------
-- RLS: admins control global rows; regular users can manage their own tasks,
-- memories, and routines via created_by/user_id matching their public profile id.
-- -------------------------------------------------------------------------
alter table public.casper_routines enable row level security;
alter table public.casper_skills enable row level security;
alter table public.casper_integrations enable row level security;

drop policy if exists casper_tasks_admin_read on public.casper_tasks;
drop policy if exists casper_tasks_admin_write on public.casper_tasks;
drop policy if exists casper_tasks_owner_read on public.casper_tasks;
create policy casper_tasks_owner_read on public.casper_tasks
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_tasks.created_by::text))
  );

drop policy if exists casper_tasks_owner_write on public.casper_tasks;
create policy casper_tasks_owner_write on public.casper_tasks
  for all to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_tasks.created_by::text))
  ) with check (
    created_by is null
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_tasks.created_by::text))
  );

drop policy if exists casper_activity_log_admin_read on public.casper_activity_log;
drop policy if exists casper_activity_log_admin_write on public.casper_activity_log;
drop policy if exists casper_activity_log_owner_read on public.casper_activity_log;
create policy casper_activity_log_owner_read on public.casper_activity_log
  for select to authenticated using (
    actor_id is null
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_activity_log.actor_id::text))
  );

drop policy if exists casper_activity_log_owner_insert on public.casper_activity_log;
create policy casper_activity_log_owner_insert on public.casper_activity_log
  for insert to authenticated with check (
    actor_id is null
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_activity_log.actor_id::text))
  );

drop policy if exists casper_memories_admin_read on public.casper_memories;
drop policy if exists casper_memories_admin_write on public.casper_memories;
drop policy if exists casper_memories_owner_read on public.casper_memories;
create policy casper_memories_owner_read on public.casper_memories
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_memories.user_id))
  );

drop policy if exists casper_memories_owner_write on public.casper_memories;
create policy casper_memories_owner_write on public.casper_memories
  for all to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_memories.user_id))
  ) with check (
    user_id is null
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_memories.user_id))
  );

drop policy if exists casper_routines_owner_read on public.casper_routines;
create policy casper_routines_owner_read on public.casper_routines
  for select to authenticated using (
    created_by is null
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_routines.created_by::text))
  );

drop policy if exists casper_routines_owner_write on public.casper_routines;
create policy casper_routines_owner_write on public.casper_routines
  for all to authenticated using (
    created_by is null
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_routines.created_by::text))
  ) with check (
    created_by is null
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_routines.created_by::text))
  );

drop policy if exists casper_skills_read_authenticated on public.casper_skills;
create policy casper_skills_read_authenticated on public.casper_skills
  for select to authenticated using (
    permission_level = 'user'
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_skills_admin_write on public.casper_skills;
create policy casper_skills_admin_write on public.casper_skills
  for all to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_integrations_owner_read on public.casper_integrations;
create policy casper_integrations_owner_read on public.casper_integrations
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_integrations.user_id::text))
  );

drop policy if exists casper_integrations_owner_write on public.casper_integrations;
create policy casper_integrations_owner_write on public.casper_integrations
  for all to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_integrations.user_id::text))
  ) with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.role = 'admin' or u.id = casper_integrations.user_id::text))
  );

-- Realtime publication and replica identity, guarded against duplicate entries.
alter table public.casper_tasks replica identity full;
alter table public.casper_activity_log replica identity full;
alter table public.casper_routines replica identity full;
alter table public.casper_skills replica identity full;
alter table public.casper_integrations replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'casper_routines') then
    alter publication supabase_realtime add table public.casper_routines;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'casper_skills') then
    alter publication supabase_realtime add table public.casper_skills;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'casper_integrations') then
    alter publication supabase_realtime add table public.casper_integrations;
  end if;
exception
  when undefined_object then
    null;
end $$;

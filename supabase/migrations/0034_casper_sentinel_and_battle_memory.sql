-- Migration 0034: Casper Sentinel, bot battle memory, and faction captains
-- Paste-safe/idempotent support for platform marshal decisions,
-- persistent Colosseum memories, and faction captain promotion.

alter table public.faction_members
  drop constraint if exists faction_members_role_allowed,
  add constraint faction_members_role_allowed check (role in ('member', 'captain', 'admin', 'founder'));

alter table public.bot_forge_config
  add column if not exists can_create_propaganda boolean not null default false,
  add column if not exists can_start_debates boolean not null default false,
  add column if not exists sentinel_enforcement_mode text not null default 'manual'
    check (sentinel_enforcement_mode in ('manual', 'recommendation', 'auto_enforce'));

create unique index if not exists faction_members_one_captain_idx
  on public.faction_members (faction_id)
  where role = 'captain';

create table if not exists public.bot_battle_memories (
  id text primary key default gen_random_uuid()::text,
  gladiator_id text references public.gladiators(id) on delete cascade,
  match_id text references public.matches(id) on delete cascade,
  opponent_gladiator_id text references public.gladiators(id) on delete set null,
  result text not null default 'unknown' check (result in ('win', 'loss', 'draw', 'unknown')),
  challenge_type text not null,
  summary text not null default '',
  trash_talk_hook text not null default '',
  rivalry_heat integer not null default 0 check (rivalry_heat >= 0 and rivalry_heat <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bot_battle_memories_gladiator_idx on public.bot_battle_memories (gladiator_id, created_at desc);
create index if not exists bot_battle_memories_match_idx on public.bot_battle_memories (match_id);
create index if not exists bot_battle_memories_opponent_idx on public.bot_battle_memories (opponent_gladiator_id);

alter table public.bot_battle_memories enable row level security;

drop policy if exists bot_battle_memories_read_authenticated on public.bot_battle_memories;
create policy bot_battle_memories_read_authenticated
on public.bot_battle_memories
for select
to authenticated
using (true);

drop policy if exists bot_battle_memories_insert_authenticated on public.bot_battle_memories;
create policy bot_battle_memories_insert_authenticated
on public.bot_battle_memories
for insert
to authenticated
with check (true);

create table if not exists public.casper_sentinel_incidents (
  id text primary key default gen_random_uuid()::text,
  bot_gladiator_id text references public.gladiators(id) on delete set null,
  bot_owner_id text references public.users(id) on delete set null,
  bot_name text not null default 'Unknown bot',
  enforcement_mode text not null default 'manual'
    check (enforcement_mode in ('manual', 'recommendation', 'auto_enforce')),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high')),
  confidence integer not null default 0 check (confidence >= 0 and confidence <= 100),
  violated_rule text not null default '',
  decision text not null default '',
  action_taken text not null default 'none'
    check (action_taken in ('none', 'notify_admin', 'recommend_kill_switch', 'kill_switch_applied', 'admin_override', 'document_success')),
  admin_override boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists casper_sentinel_incidents_created_idx on public.casper_sentinel_incidents (created_at desc);
create index if not exists casper_sentinel_incidents_bot_idx on public.casper_sentinel_incidents (bot_gladiator_id, created_at desc);
create index if not exists casper_sentinel_incidents_mode_idx on public.casper_sentinel_incidents (enforcement_mode, severity);

alter table public.casper_sentinel_incidents enable row level security;

drop policy if exists casper_sentinel_incidents_admin_read on public.casper_sentinel_incidents;
create policy casper_sentinel_incidents_admin_read
on public.casper_sentinel_incidents
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_uid = (select auth.uid())
      and u.role in ('admin', 'moderator')
  )
);

drop policy if exists casper_sentinel_incidents_admin_insert on public.casper_sentinel_incidents;
create policy casper_sentinel_incidents_admin_insert
on public.casper_sentinel_incidents
for insert
to authenticated
with check (
  exists (
    select 1 from public.users u
    where u.auth_uid = (select auth.uid())
      and u.role in ('admin', 'moderator')
  )
);

drop policy if exists casper_sentinel_incidents_admin_update on public.casper_sentinel_incidents;
create policy casper_sentinel_incidents_admin_update
on public.casper_sentinel_incidents
for update
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_uid = (select auth.uid())
      and u.role in ('admin', 'moderator')
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_uid = (select auth.uid())
      and u.role in ('admin', 'moderator')
  )
);

do $$
begin
  alter publication supabase_realtime add table public.bot_battle_memories;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.casper_sentinel_incidents;
exception
  when duplicate_object then null;
end $$;

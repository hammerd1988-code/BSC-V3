-- 0058_bot_mayhem_maga_switches.sql
-- MAGA switches: AI-driven persona reconfiguration and bot-community dynamics.

create table if not exists public.bot_mayhem_persona_overrides (
  username text primary key references public.users(username) on delete cascade,
  system_prompt text not null,
  bio text not null,
  status_message text not null,
  campaign text not null,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_mayhem_maga_switches (
  id text primary key,
  name text not null,
  description text not null default '',
  active boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_by text references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists bot_mayhem_persona_overrides_campaign_idx on public.bot_mayhem_persona_overrides(campaign);
create index if not exists bot_mayhem_maga_switches_active_idx on public.bot_mayhem_maga_switches(active);

alter table public.bot_mayhem_persona_overrides enable row level security;
alter table public.bot_mayhem_maga_switches enable row level security;

-- Admin-only helper (idempotent; already created by 0057, kept here for safety)
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

drop policy if exists bot_mayhem_persona_overrides_admin_all on public.bot_mayhem_persona_overrides;
create policy bot_mayhem_persona_overrides_admin_all on public.bot_mayhem_persona_overrides
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists bot_mayhem_maga_switches_admin_all on public.bot_mayhem_maga_switches;
create policy bot_mayhem_maga_switches_admin_all on public.bot_mayhem_maga_switches
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

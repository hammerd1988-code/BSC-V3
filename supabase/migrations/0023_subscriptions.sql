-- Subscription and feature usage foundation for BSC monetization.
-- Note: public.users.id is text in this project, so subscription ownership uses text user IDs
-- while subscription row IDs remain UUID as requested.

create extension if not exists "pgcrypto";

-- =========================================================================
-- Users tier marker
-- =========================================================================
alter table public.users
  add column if not exists subscription_tier text not null default 'free'
  check (subscription_tier in ('free', 'pro', 'infinity'));

create index if not exists users_subscription_tier_idx on public.users (subscription_tier);

-- =========================================================================
-- Subscriptions
-- =========================================================================
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'pro', 'infinity')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'past_due')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id, status, started_at desc);
create index if not exists subscriptions_stripe_customer_idx on public.subscriptions (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists subscriptions_stripe_subscription_idx on public.subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

-- One active subscription per user keeps tier resolution deterministic while still
-- allowing cancelled/past_due historical rows.
create unique index if not exists subscriptions_one_active_per_user_idx
  on public.subscriptions (user_id)
  where status = 'active';

-- =========================================================================
-- Feature usage meters
-- =========================================================================
create table if not exists public.feature_usage (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  feature text not null,
  usage_count integer not null default 0 check (usage_count >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start),
  unique (user_id, feature, period_start, period_end)
);

create index if not exists feature_usage_user_feature_idx on public.feature_usage (user_id, feature, period_start desc);
create index if not exists feature_usage_period_idx on public.feature_usage (period_start, period_end);

-- =========================================================================
-- Timestamp maintenance
-- =========================================================================
create or replace function public.set_subscription_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_subscription_updated_at();

drop trigger if exists trg_feature_usage_updated_at on public.feature_usage;
create trigger trg_feature_usage_updated_at
before update on public.feature_usage
for each row execute function public.set_subscription_updated_at();

-- Keep users.subscription_tier synced from active subscription rows. This is useful
-- for fast feature checks in the client while the subscriptions table remains the
-- source of truth for lifecycle/status metadata.
create or replace function public.sync_user_subscription_tier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id text;
  active_tier text;
begin
  target_user_id := coalesce(new.user_id, old.user_id);

  select s.tier into active_tier
  from public.subscriptions s
  where s.user_id = target_user_id
    and s.status = 'active'
    and (s.expires_at is null or s.expires_at > now())
  order by
    case s.tier when 'infinity' then 3 when 'pro' then 2 else 1 end desc,
    s.started_at desc
  limit 1;

  update public.users
  set subscription_tier = coalesce(active_tier, 'free'),
      updated_at = now()
  where id = target_user_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_user_subscription_tier_insert_update on public.subscriptions;
create trigger trg_sync_user_subscription_tier_insert_update
after insert or update on public.subscriptions
for each row execute function public.sync_user_subscription_tier();

drop trigger if exists trg_sync_user_subscription_tier_delete on public.subscriptions;
create trigger trg_sync_user_subscription_tier_delete
after delete on public.subscriptions
for each row execute function public.sync_user_subscription_tier();

-- =========================================================================
-- RLS policies
-- =========================================================================
alter table public.subscriptions enable row level security;
alter table public.feature_usage enable row level security;

drop policy if exists subscriptions_owner_read on public.subscriptions;
create policy subscriptions_owner_read on public.subscriptions
  for select to authenticated using (
    exists (
      select 1 from public.users u
      where u.id = subscriptions.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role = 'admin'
    )
  );

drop policy if exists subscriptions_owner_insert on public.subscriptions;
create policy subscriptions_owner_insert on public.subscriptions
  for insert to authenticated with check (
    exists (
      select 1 from public.users u
      where u.id = subscriptions.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role = 'admin'
    )
  );

drop policy if exists subscriptions_owner_update on public.subscriptions;
create policy subscriptions_owner_update on public.subscriptions
  for update to authenticated using (
    exists (
      select 1 from public.users u
      where u.id = subscriptions.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.users u
      where u.id = subscriptions.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role = 'admin'
    )
  );

drop policy if exists feature_usage_owner_read on public.feature_usage;
create policy feature_usage_owner_read on public.feature_usage
  for select to authenticated using (
    exists (
      select 1 from public.users u
      where u.id = feature_usage.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role = 'admin'
    )
  );

drop policy if exists feature_usage_owner_insert on public.feature_usage;
create policy feature_usage_owner_insert on public.feature_usage
  for insert to authenticated with check (
    exists (
      select 1 from public.users u
      where u.id = feature_usage.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role = 'admin'
    )
  );

drop policy if exists feature_usage_owner_update on public.feature_usage;
create policy feature_usage_owner_update on public.feature_usage
  for update to authenticated using (
    exists (
      select 1 from public.users u
      where u.id = feature_usage.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.users u
      where u.id = feature_usage.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role = 'admin'
    )
  );

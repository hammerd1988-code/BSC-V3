-- Native push device tokens for the Capacitor mobile app (iOS APNs / Android FCM).
-- Distinct from public.push_subscriptions, which stores browser Web Push
-- subscriptions. One row per device token; written by the server through
-- SUPABASE_SERVICE_ROLE_KEY and readable/manageable by the owning user via RLS.

create table if not exists public.device_push_tokens (
    id         text primary key default gen_random_uuid()::text,
    user_id    uuid not null references public.users(id) on delete cascade,
    token      text not null unique,
    platform   text not null check (platform in ('ios', 'android')),
    is_active  boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id, is_active);
create index if not exists device_push_tokens_updated_idx on public.device_push_tokens (updated_at desc);

alter table public.device_push_tokens enable row level security;

drop policy if exists device_push_tokens_select_owner on public.device_push_tokens;
create policy device_push_tokens_select_owner
on public.device_push_tokens
for select
using (
  exists (
    select 1
    from public.users u
    where u.id = device_push_tokens.user_id
      and u.auth_uid = (select auth.uid())
  )
);

drop policy if exists device_push_tokens_insert_owner on public.device_push_tokens;
create policy device_push_tokens_insert_owner
on public.device_push_tokens
for insert
with check (
  exists (
    select 1
    from public.users u
    where u.id = device_push_tokens.user_id
      and u.auth_uid = (select auth.uid())
  )
);

drop policy if exists device_push_tokens_update_owner on public.device_push_tokens;
create policy device_push_tokens_update_owner
on public.device_push_tokens
for update
using (
  exists (
    select 1
    from public.users u
    where u.id = device_push_tokens.user_id
      and u.auth_uid = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = device_push_tokens.user_id
      and u.auth_uid = (select auth.uid())
  )
);

drop policy if exists device_push_tokens_delete_owner on public.device_push_tokens;
create policy device_push_tokens_delete_owner
on public.device_push_tokens
for delete
using (
  exists (
    select 1
    from public.users u
    where u.id = device_push_tokens.user_id
      and u.auth_uid = (select auth.uid())
  )
);

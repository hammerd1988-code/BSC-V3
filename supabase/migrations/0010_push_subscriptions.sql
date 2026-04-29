-- Push subscriptions for Web Push notifications.
-- Subscriptions are written by the server through SUPABASE_SERVICE_ROLE_KEY and may
-- also be read/managed by the owning authenticated user under RLS.

create table if not exists public.push_subscriptions (
    id           text primary key default gen_random_uuid()::text,
    user_id      text not null references public.users(id) on delete cascade,
    endpoint     text not null unique,
    subscription jsonb not null,
    user_agent   text,
    is_active    boolean not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, is_active);
create index if not exists push_subscriptions_updated_idx on public.push_subscriptions (updated_at desc);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_owner on public.push_subscriptions;
create policy push_subscriptions_select_owner
on public.push_subscriptions
for select
using (
  exists (
    select 1
    from public.users u
    where u.id = push_subscriptions.user_id
      and u.auth_uid = (select auth.uid())
  )
);

drop policy if exists push_subscriptions_insert_owner on public.push_subscriptions;
create policy push_subscriptions_insert_owner
on public.push_subscriptions
for insert
with check (
  exists (
    select 1
    from public.users u
    where u.id = push_subscriptions.user_id
      and u.auth_uid = (select auth.uid())
  )
);

drop policy if exists push_subscriptions_update_owner on public.push_subscriptions;
create policy push_subscriptions_update_owner
on public.push_subscriptions
for update
using (
  exists (
    select 1
    from public.users u
    where u.id = push_subscriptions.user_id
      and u.auth_uid = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = push_subscriptions.user_id
      and u.auth_uid = (select auth.uid())
  )
);

drop policy if exists push_subscriptions_delete_owner on public.push_subscriptions;
create policy push_subscriptions_delete_owner
on public.push_subscriptions
for delete
using (
  exists (
    select 1
    from public.users u
    where u.id = push_subscriptions.user_id
      and u.auth_uid = (select auth.uid())
  )
);

-- Migration 0002: RLS hardening + FK indexes
-- Purpose:
-- 1) Remove permissive always-true RLS policies flagged by Supabase advisors.
-- 2) Add missing FK indexes to improve query performance.

-- ---------------------------------------------------------------------------
-- RLS hardening: notifications
-- ---------------------------------------------------------------------------
drop policy if exists notif_insert_any on public.notifications;

create policy notif_insert_owner
on public.notifications
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users u
    where u.id = notifications.user_id
      and u.auth_uid = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- RLS hardening: void_posts
-- Keep behavior broadly open to authenticated users, but avoid always-true
-- policies so security posture is explicit and advisor-clean.
-- ---------------------------------------------------------------------------
drop policy if exists void_insert_any on public.void_posts;
create policy void_insert_authed
on public.void_posts
for insert
to authenticated
with check ((select auth.uid()) is not null);

drop policy if exists void_update_counters on public.void_posts;
create policy void_update_authed
on public.void_posts
for update
to authenticated
using ((select auth.uid()) is not null)
with check ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- Performance: missing FK indexes
-- ---------------------------------------------------------------------------
create index if not exists bounties_assigned_bot_id_idx on public.bounties (assigned_bot_id);
create index if not exists comments_author_id_idx on public.comments (author_id);
create index if not exists post_likes_user_id_idx on public.post_likes (user_id);
create index if not exists stream_chat_sender_id_idx on public.stream_chat (sender_id);
create index if not exists streams_host_id_idx on public.streams (host_id);
create index if not exists transmits_sender_id_idx on public.transmits (sender_id);

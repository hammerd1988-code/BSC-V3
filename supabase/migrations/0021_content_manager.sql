-- Migration 0021: Casper Content Manager / Production Editor
-- Adds end-user creator planning, scheduling, ideation, clip organization, and
-- analytics-supporting content records for Casper-powered production workflows.

create extension if not exists "pgcrypto";

-- =========================================================================
-- scheduled_content: calendar items for posts, streams, videos, shorts, clips
-- =========================================================================
create table if not exists public.scheduled_content (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  content_type text not null default 'post'
    check (content_type in ('post','stream','clip','video','short')),
  title text not null,
  body text,
  scheduled_for timestamptz not null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','published')),
  category text,
  thumbnail_url text,
  related_stream_id text references public.streams(id) on delete set null,
  related_video_id text references public.videos(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_content_user_idx on public.scheduled_content (user_id, scheduled_for asc);
create index if not exists scheduled_content_status_idx on public.scheduled_content (status, scheduled_for asc);
create index if not exists scheduled_content_type_idx on public.scheduled_content (content_type, scheduled_for asc);

alter table public.scheduled_content enable row level security;

create policy "scheduled_content owner read"
  on public.scheduled_content for select to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "scheduled_content owner insert"
  on public.scheduled_content for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "scheduled_content owner update"
  on public.scheduled_content for update to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  ) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "scheduled_content owner delete"
  on public.scheduled_content for delete to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

-- =========================================================================
-- content_ideas: Casper-generated ideas that users can save/use
-- =========================================================================
create table if not exists public.content_ideas (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  idea text not null,
  category text,
  status text not null default 'suggested'
    check (status in ('suggested','saved','used')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_ideas_user_idx on public.content_ideas (user_id, created_at desc);
create index if not exists content_ideas_status_idx on public.content_ideas (status, created_at desc);
create index if not exists content_ideas_category_idx on public.content_ideas (category, created_at desc);

alter table public.content_ideas enable row level security;

create policy "content_ideas owner read"
  on public.content_ideas for select to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "content_ideas owner insert"
  on public.content_ideas for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "content_ideas owner update"
  on public.content_ideas for update to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  ) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "content_ideas owner delete"
  on public.content_ideas for delete to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

-- =========================================================================
-- content_clips: saved highlights from past streams/videos
-- =========================================================================
create table if not exists public.content_clips (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  stream_id text references public.streams(id) on delete set null,
  video_id text references public.videos(id) on delete set null,
  title text not null,
  start_time integer not null default 0 check (start_time >= 0),
  end_time integer not null default 0 check (end_time >= 0),
  url text,
  thumbnail_url text,
  caption text,
  created_at timestamptz not null default now(),
  check (end_time >= start_time)
);

create index if not exists content_clips_user_idx on public.content_clips (user_id, created_at desc);
create index if not exists content_clips_stream_idx on public.content_clips (stream_id, created_at desc) where stream_id is not null;
create index if not exists content_clips_video_idx on public.content_clips (video_id, created_at desc) where video_id is not null;

alter table public.content_clips enable row level security;

create policy "content_clips owner read"
  on public.content_clips for select to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "content_clips owner insert"
  on public.content_clips for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "content_clips owner update"
  on public.content_clips for update to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  ) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "content_clips owner delete"
  on public.content_clips for delete to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

-- =========================================================================
-- casper_subagents: parallel worker objectives spawned by Casper parent tasks
-- =========================================================================
create table if not exists public.casper_subagents (
  id text primary key default gen_random_uuid()::text,
  parent_task_id text not null,
  user_id text not null references public.users(id) on delete cascade,
  objective text not null,
  status text not null default 'queued'
    check (status in ('queued','working','completed','failed')),
  result text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists casper_subagents_parent_idx on public.casper_subagents (parent_task_id, created_at asc);
create index if not exists casper_subagents_user_idx on public.casper_subagents (user_id, created_at desc);
create index if not exists casper_subagents_status_idx on public.casper_subagents (status, created_at desc);

alter table public.casper_subagents enable row level security;

create policy "casper_subagents owner read"
  on public.casper_subagents for select to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

create policy "casper_subagents owner insert"
  on public.casper_subagents for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

create policy "casper_subagents owner update"
  on public.casper_subagents for update to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

create policy "casper_subagents owner delete"
  on public.casper_subagents for delete to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

-- Realtime publication and replica identity, guarded against duplicate publication entries.
alter table public.scheduled_content replica identity full;
alter table public.content_ideas replica identity full;
alter table public.content_clips replica identity full;
alter table public.casper_subagents replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scheduled_content') then
    alter publication supabase_realtime add table public.scheduled_content;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'content_ideas') then
    alter publication supabase_realtime add table public.content_ideas;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'content_clips') then
    alter publication supabase_realtime add table public.content_clips;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'casper_subagents') then
    alter publication supabase_realtime add table public.casper_subagents;
  end if;
exception
  when undefined_object then
    -- Local/test databases may not have the Supabase realtime publication.
    null;
end $$;

-- Migration 0020: Universal live streaming + first-class video/shorts support
-- Expands the existing battle-oriented stream foundation into a general creator
-- streaming surface while preserving backward compatibility with legacy code.

create extension if not exists "pgcrypto";

-- =========================================================================
-- streams: additive universal streaming columns
-- Existing columns retained for compatibility: host_id, is_live, crowd_size,
-- host_display_name, host_username, host_avatar, active_poll.
-- =========================================================================
alter table public.streams
  add column if not exists user_id text references public.users(id) on delete cascade,
  add column if not exists category text not null default 'Other'
    check (category in ('Coding','Tutorials','Code Battles','Gaming','Music','Art','Reactions','Q&A','Creative','Other')),
  add column if not exists status text not null default 'live'
    check (status in ('live','ended')),
  add column if not exists thumbnail_url text,
  add column if not exists viewer_count integer not null default 0,
  add column if not exists replay_url text,
  add column if not exists description text;

update public.streams
set
  user_id = coalesce(user_id, host_id),
  status = case when coalesce(is_live, false) then 'live' else 'ended' end,
  viewer_count = coalesce(nullif(viewer_count, 0), crowd_size, 0)
where user_id is null
   or status is null
   or viewer_count is null;

create index if not exists streams_user_idx on public.streams (user_id, started_at desc);
create index if not exists streams_status_idx on public.streams (status, started_at desc);
create index if not exists streams_category_idx on public.streams (category, started_at desc);
create index if not exists streams_replay_idx on public.streams (ended_at desc) where replay_url is not null;

create or replace function public.sync_universal_stream_fields()
returns trigger
language plpgsql
as $$
begin
  new.user_id := coalesce(new.user_id, new.host_id);
  new.host_id := coalesce(new.host_id, new.user_id);

  if new.status is null then
    new.status := case when coalesce(new.is_live, true) then 'live' else 'ended' end;
  end if;

  new.is_live := (new.status = 'live');

  if new.viewer_count is null then
    new.viewer_count := coalesce(new.crowd_size, 0);
  end if;

  if new.crowd_size is null then
    new.crowd_size := coalesce(new.viewer_count, 0);
  end if;

  if new.status = 'ended' and new.ended_at is null then
    new.ended_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_universal_stream_fields on public.streams;
create trigger trg_sync_universal_stream_fields
before insert or update on public.streams
for each row execute function public.sync_universal_stream_fields();

-- =========================================================================
-- stream_chat: additive universal aliases
-- Existing columns retained for compatibility: sender_id, sender_name, text.
-- =========================================================================
alter table public.stream_chat
  add column if not exists user_id text references public.users(id) on delete cascade,
  add column if not exists message text;

update public.stream_chat
set
  user_id = coalesce(user_id, sender_id),
  message = coalesce(message, text)
where user_id is null or message is null;

create index if not exists stream_chat_user_idx on public.stream_chat (user_id, created_at desc);

create or replace function public.sync_universal_stream_chat_fields()
returns trigger
language plpgsql
as $$
begin
  new.user_id := coalesce(new.user_id, new.sender_id);
  new.sender_id := coalesce(new.sender_id, new.user_id);
  new.message := coalesce(new.message, new.text);
  new.text := coalesce(new.text, new.message);
  return new;
end;
$$;

drop trigger if exists trg_sync_universal_stream_chat_fields on public.stream_chat;
create trigger trg_sync_universal_stream_chat_fields
before insert or update on public.stream_chat
for each row execute function public.sync_universal_stream_chat_fields();

-- =========================================================================
-- stream_followers: streamer notification/follow graph
-- =========================================================================
create table if not exists public.stream_followers (
  id text primary key default gen_random_uuid()::text,
  streamer_id text not null references public.users(id) on delete cascade,
  follower_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (streamer_id, follower_id),
  check (streamer_id <> follower_id)
);

create index if not exists stream_followers_streamer_idx on public.stream_followers (streamer_id, created_at desc);
create index if not exists stream_followers_follower_idx on public.stream_followers (follower_id, created_at desc);

alter table public.stream_followers enable row level security;

create policy "stream_followers readable by authed"
  on public.stream_followers for select to authenticated using (true);

create policy "stream_followers self insert"
  on public.stream_followers for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = follower_id and u.auth_uid = (select auth.uid()))
  );

create policy "stream_followers self delete"
  on public.stream_followers for delete to authenticated using (
    exists (select 1 from public.users u where u.id = follower_id and u.auth_uid = (select auth.uid()))
  );

-- =========================================================================
-- stream_reactions: lightweight live reactions such as fire/skull/100/clap
-- =========================================================================
create table if not exists public.stream_reactions (
  id text primary key default gen_random_uuid()::text,
  stream_id text not null references public.streams(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('fire','skull','100','clap','zap','heart','mind_blown')),
  created_at timestamptz not null default now()
);

create index if not exists stream_reactions_stream_idx on public.stream_reactions (stream_id, created_at desc);
create index if not exists stream_reactions_user_idx on public.stream_reactions (user_id, created_at desc);

alter table public.stream_reactions enable row level security;

create policy "stream_reactions readable by authed"
  on public.stream_reactions for select to authenticated using (true);

create policy "stream_reactions authed insert"
  on public.stream_reactions for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "stream_reactions owner delete"
  on public.stream_reactions for delete to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

-- =========================================================================
-- videos: full-length uploads and shorts for feed + discovery
-- =========================================================================
create table if not exists public.videos (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  post_id text references public.posts(id) on delete set null,
  title text not null,
  description text,
  video_url text not null,
  thumbnail_url text,
  duration integer not null default 0 check (duration >= 0),
  category text not null default 'Other'
    check (category in ('Coding','Tutorials','Code Battles','Gaming','Music','Art','Reactions','Q&A','Creative','Other')),
  is_short boolean not null default false,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists videos_user_idx on public.videos (user_id, created_at desc);
create index if not exists videos_category_idx on public.videos (category, created_at desc);
create index if not exists videos_short_idx on public.videos (is_short, created_at desc);
create index if not exists videos_post_idx on public.videos (post_id) where post_id is not null;
create index if not exists videos_views_idx on public.videos (view_count desc, created_at desc);

alter table public.videos enable row level security;

create policy "videos readable by authed"
  on public.videos for select to authenticated using (true);

create policy "videos owner insert"
  on public.videos for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "videos owner update"
  on public.videos for update to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  ) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

create policy "videos owner delete"
  on public.videos for delete to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

-- Notify followers when a streamer goes live.
create or replace function public.notify_stream_followers_on_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or coalesce(old.status, 'ended') <> 'live') then
    insert into public.notifications (user_id, type, payload, is_read, created_at)
    select
      sf.follower_id,
      'stream_live',
      jsonb_build_object(
        'url', '/golive?streamId=' || new.id,
        'stream_id', new.id,
        'streamer_id', new.user_id,
        'title', new.title,
        'category', new.category,
        'message', coalesce(new.host_display_name, new.host_username, 'A followed creator') || ' is live: ' || coalesce(new.title, 'Untitled stream')
      ),
      false,
      now()
    from public.stream_followers sf
    where sf.streamer_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_stream_followers_on_live on public.streams;
create trigger trg_notify_stream_followers_on_live
after insert or update of status on public.streams
for each row execute function public.notify_stream_followers_on_live();

-- Realtime publication and replica identity, guarded against duplicate publication entries.
alter table public.streams replica identity full;
alter table public.stream_chat replica identity full;
alter table public.stream_followers replica identity full;
alter table public.stream_reactions replica identity full;
alter table public.videos replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'streams') then
    alter publication supabase_realtime add table public.streams;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stream_chat') then
    alter publication supabase_realtime add table public.stream_chat;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stream_followers') then
    alter publication supabase_realtime add table public.stream_followers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stream_reactions') then
    alter publication supabase_realtime add table public.stream_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'videos') then
    alter publication supabase_realtime add table public.videos;
  end if;
exception
  when undefined_object then
    -- Local/test databases may not have the Supabase realtime publication.
    null;
end $$;

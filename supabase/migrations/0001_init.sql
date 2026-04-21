-- Blood Sweat Code — Supabase schema
-- All tables use text primary keys so existing doc IDs (e.g. "bot-<username>", "void-architect-bot")
-- continue to work; new rows default to uuid strings.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =========================================================================
-- users
-- =========================================================================
create table if not exists public.users (
    id              text primary key,
    auth_uid        uuid references auth.users(id) on delete set null,
    username        text unique not null,
    display_name    text not null,
    email           text,
    avatar_url      text,
    cover_url       text,
    bio             text default '',
    type            text not null default 'human' check (type in ('human','bot')),
    role            text not null default 'user' check (role in ('user','admin','moderator')),
    followers_count integer not null default 0,
    following_count integer not null default 0,
    reputation_score integer not null default 0,
    cred_balance    integer not null default 500,
    compute_tokens  integer not null default 0,
    last_daily_cred timestamptz,
    is_online       boolean not null default false,
    last_seen       timestamptz,
    is_live         boolean not null default false,
    active_stream_id text,
    friends         text[] not null default '{}',
    blocked_users   text[] not null default '{}',
    custom_accent   text,
    status_message  text,
    view_count      integer not null default 0,
    sponsored_entity jsonb,
    ai_settings     jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists users_auth_uid_idx on public.users (auth_uid);
create index if not exists users_type_idx on public.users (type);

-- =========================================================================
-- posts
-- =========================================================================
create table if not exists public.posts (
    id              text primary key default gen_random_uuid()::text,
    author_id       text not null references public.users(id) on delete cascade,
    content         text not null,
    media_url       text,
    media_type      text check (media_type in ('image','video')),
    type            text,
    likes           integer not null default 0,
    boosts          integer not null default 0,
    comments_count  integer not null default 0,
    shares_count    integer not null default 0,
    is_boosted      boolean not null default false,
    neural_tags     text[] not null default '{}',
    last_comment_at timestamptz,
    created_at      timestamptz not null default now()
);

create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists posts_created_idx on public.posts (created_at desc);

-- =========================================================================
-- comments
-- =========================================================================
create table if not exists public.comments (
    id         text primary key default gen_random_uuid()::text,
    post_id    text not null references public.posts(id) on delete cascade,
    author_id  text not null references public.users(id) on delete cascade,
    content    text not null,
    created_at timestamptz not null default now()
);

create index if not exists comments_post_idx on public.comments (post_id, created_at);

-- =========================================================================
-- post_likes (join table for tracking user likes on posts)
-- =========================================================================
create table if not exists public.post_likes (
    post_id    text not null references public.posts(id) on delete cascade,
    user_id    text not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (post_id, user_id)
);

-- =========================================================================
-- transmissions (DM threads) and transmits (messages)
-- =========================================================================
create table if not exists public.transmissions (
    id              text primary key default gen_random_uuid()::text,
    participant_ids text[] not null,
    last_transmit   jsonb,
    unread_counts   jsonb not null default '{}'::jsonb,
    typing_status   jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists transmissions_participants_idx
    on public.transmissions using gin (participant_ids);

create table if not exists public.transmits (
    id              text primary key default gen_random_uuid()::text,
    transmission_id text not null references public.transmissions(id) on delete cascade,
    sender_id       text not null references public.users(id) on delete cascade,
    content         text not null,
    type            text not null default 'text' check (type in ('text','media','call')),
    media_url       text,
    media_type      text check (media_type in ('image','video')),
    encryption_key  text,
    read_at         timestamptz,
    burn_duration   integer,
    expires_at      timestamptz,
    created_at      timestamptz not null default now()
);

create index if not exists transmits_tx_idx on public.transmits (transmission_id, created_at);

-- =========================================================================
-- streams (live) + stream_chat
-- =========================================================================
create table if not exists public.streams (
    id                text primary key default gen_random_uuid()::text,
    host_id           text not null references public.users(id) on delete cascade,
    host_display_name text,
    host_username     text,
    host_avatar       text,
    title             text,
    is_live           boolean not null default true,
    crowd_size        integer not null default 0,
    started_at        timestamptz not null default now(),
    ended_at          timestamptz
);

create index if not exists streams_live_idx on public.streams (is_live);

create table if not exists public.stream_chat (
    id          text primary key default gen_random_uuid()::text,
    stream_id   text not null references public.streams(id) on delete cascade,
    sender_id   text not null references public.users(id) on delete cascade,
    sender_name text,
    text        text not null,
    created_at  timestamptz not null default now()
);

create index if not exists stream_chat_stream_idx on public.stream_chat (stream_id, created_at);

-- =========================================================================
-- void_posts
-- =========================================================================
create table if not exists public.void_posts (
    id           text primary key default gen_random_uuid()::text,
    content      text not null,
    decay_rate   numeric not null default 0.1,
    view_count   integer not null default 0,
    like_count   integer not null default 0,
    is_anonymous boolean not null default true,
    is_echo      boolean not null default false,
    expires_at   timestamptz not null,
    created_at   timestamptz not null default now()
);

create index if not exists void_posts_created_idx on public.void_posts (created_at desc);

-- =========================================================================
-- bounties (Neural Job Market)
-- =========================================================================
create table if not exists public.bounties (
    id                text primary key default gen_random_uuid()::text,
    creator_id        text not null references public.users(id) on delete cascade,
    title             text not null,
    description       text not null,
    reward            integer not null default 0,
    status            text not null default 'open'
                      check (status in ('open','in-progress','review','completed','cancelled','rejected')),
    category          text,
    assigned_bot_id   text references public.users(id) on delete set null,
    due_date          timestamptz,
    completed_at      timestamptz,
    result            text,
    proof_of_work     text,
    review_comment    text,
    created_at        timestamptz not null default now()
);

create index if not exists bounties_status_idx on public.bounties (status);
create index if not exists bounties_creator_idx on public.bounties (creator_id);

-- =========================================================================
-- transactions (CRED ledger)
-- =========================================================================
create table if not exists public.transactions (
    id          text primary key default gen_random_uuid()::text,
    user_id     text not null references public.users(id) on delete cascade,
    amount      integer not null,
    type        text not null check (type in ('spend','earn','purchase')),
    description text,
    created_at  timestamptz not null default now()
);

create index if not exists transactions_user_idx on public.transactions (user_id, created_at desc);

-- =========================================================================
-- notifications
-- =========================================================================
create table if not exists public.notifications (
    id         text primary key default gen_random_uuid()::text,
    user_id    text not null references public.users(id) on delete cascade,
    type       text not null,
    payload    jsonb not null default '{}'::jsonb,
    is_read    boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- =========================================================================
-- active_threats (AdminDashboard)
-- =========================================================================
create table if not exists public.active_threats (
    id         text primary key default gen_random_uuid()::text,
    severity   text not null,
    source     text,
    summary    text,
    created_at timestamptz not null default now()
);

-- =========================================================================
-- Atomic counter helper used by the shim's `increment()` emulation.
-- =========================================================================
create or replace function public.apply_increments(
    p_table text,
    p_id    text,
    p_delta jsonb   -- {"likes": 1, "boosts": -2}
) returns void
language plpgsql
as $$
declare
    col text;
    val numeric;
    sets text := '';
begin
    for col, val in select key, (value::text)::numeric from jsonb_each_text(p_delta) loop
        sets := sets || format('%I = coalesce(%I,0) + %L, ', col, col, val);
    end loop;

    if length(sets) = 0 then
        return;
    end if;

    execute format(
        'update public.%I set %s updated_at = now() where id = %L',
        p_table, rtrim(sets, ', '), p_id
    );
end;
$$;

-- =========================================================================
-- Row Level Security
-- Defines access policies for each table.
-- =========================================================================
alter table public.users          enable row level security;
alter table public.posts          enable row level security;
alter table public.comments       enable row level security;
alter table public.post_likes     enable row level security;
alter table public.transmissions  enable row level security;
alter table public.transmits      enable row level security;
alter table public.streams        enable row level security;
alter table public.stream_chat    enable row level security;
alter table public.void_posts     enable row level security;
alter table public.bounties       enable row level security;
alter table public.transactions   enable row level security;
alter table public.notifications  enable row level security;
alter table public.active_threats enable row level security;

-- Authed read-everywhere policies
create policy "users readable by authed"      on public.users          for select using (auth.role() = 'authenticated');
create policy "users self-insert"              on public.users          for insert with check (auth.uid() = auth_uid);
create policy "users self-update"              on public.users          for update using (auth.uid() = auth_uid);

create policy "posts readable by authed"       on public.posts          for select using (auth.role() = 'authenticated');
create policy "posts authed insert"            on public.posts          for insert with check (auth.role() = 'authenticated');
create policy "posts owner update"             on public.posts          for update using (
    exists (select 1 from public.users u where u.id = author_id and u.auth_uid = auth.uid())
);
create policy "posts owner delete"             on public.posts          for delete using (
    exists (select 1 from public.users u where u.id = author_id and u.auth_uid = auth.uid())
);

create policy "comments readable by authed"    on public.comments       for select using (auth.role() = 'authenticated');
create policy "comments authed insert"         on public.comments       for insert with check (auth.role() = 'authenticated');

create policy "likes readable by authed"       on public.post_likes     for select using (auth.role() = 'authenticated');
create policy "likes self"                     on public.post_likes     for all    using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = auth.uid())
) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = auth.uid())
);

create policy "transmissions participants"     on public.transmissions  for all    using (
    exists (select 1 from public.users u
            where u.auth_uid = auth.uid()
              and u.id = any(participant_ids))
);

create policy "transmits participants"         on public.transmits      for all    using (
    exists (
        select 1 from public.transmissions t
        join public.users u on u.id = any(t.participant_ids)
        where t.id = transmits.transmission_id and u.auth_uid = auth.uid()
    )
);

create policy "streams authed read"            on public.streams        for select using (auth.role() = 'authenticated');
create policy "streams host write"             on public.streams        for all    using (
    exists (select 1 from public.users u where u.id = host_id and u.auth_uid = auth.uid())
) with check (
    exists (select 1 from public.users u where u.id = host_id and u.auth_uid = auth.uid())
);

create policy "stream_chat authed read"        on public.stream_chat    for select using (auth.role() = 'authenticated');
create policy "stream_chat authed write"       on public.stream_chat    for insert with check (auth.role() = 'authenticated');

create policy "void authed read"               on public.void_posts     for select using (auth.role() = 'authenticated');
create policy "void authed write"              on public.void_posts     for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "bounties authed read"           on public.bounties       for select using (auth.role() = 'authenticated');
create policy "bounties creator write"         on public.bounties       for all    using (
    exists (select 1 from public.users u where u.id = creator_id and u.auth_uid = auth.uid())
) with check (
    exists (select 1 from public.users u where u.id = creator_id and u.auth_uid = auth.uid())
);

create policy "tx owner"                       on public.transactions   for all    using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = auth.uid())
) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = auth.uid())
);

create policy "notifications owner"            on public.notifications  for all    using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = auth.uid())
) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = auth.uid())
);

create policy "threats admin read"             on public.active_threats for select using (
    exists (select 1 from public.users u where u.auth_uid = auth.uid() and u.role = 'admin')
);

-- Follow relationships between users.
-- Uses composite PK so a user can only follow another user once.

create table if not exists public.follows (
    follower_id  text not null references public.users(id) on delete cascade,
    following_id text not null references public.users(id) on delete cascade,
    created_at   timestamptz not null default now(),
    primary key (follower_id, following_id)
);

create index if not exists follows_follower_idx  on public.follows (follower_id);
create index if not exists follows_following_idx on public.follows (following_id);

alter table public.follows enable row level security;

-- Anyone authenticated can read follows
create policy "follows_select" on public.follows
    for select using (true);

-- Users can only insert/delete their own follow rows
create policy "follows_insert" on public.follows
    for insert with check (
        follower_id = (select id from public.users where auth_uid = auth.uid())
    );

create policy "follows_delete" on public.follows
    for delete using (
        follower_id = (select id from public.users where auth_uid = auth.uid())
    );

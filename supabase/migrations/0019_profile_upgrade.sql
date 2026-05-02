-- Migration 0019: Major profile system upgrade
-- Adds rich profile fields, interest-based factions, activity heatmaps, and faction-linked posts.

-- -----------------------------------------------------------------------------
-- Profile upgrade columns
-- -----------------------------------------------------------------------------
alter table public.users
  add column if not exists tech_stack jsonb not null default '[]'::jsonb,
  add column if not exists currently_building text,
  add column if not exists profile_layout text not null default 'developer',
  add column if not exists skills_manifest jsonb not null default '[]'::jsonb,
  add column if not exists looking_for jsonb not null default '[]'::jsonb;

alter table public.users
  add constraint users_tech_stack_array check (jsonb_typeof(tech_stack) = 'array'),
  add constraint users_skills_manifest_array check (jsonb_typeof(skills_manifest) = 'array'),
  add constraint users_looking_for_array check (jsonb_typeof(looking_for) = 'array'),
  add constraint users_profile_layout_allowed check (profile_layout in ('developer', 'showcase', 'minimal')),
  add constraint users_currently_building_length check (currently_building is null or char_length(currently_building) <= 240);

-- -----------------------------------------------------------------------------
-- Factions: interest-based subgroups / communities
-- -----------------------------------------------------------------------------
create table if not exists public.factions (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  slug text not null unique,
  description text not null default '',
  icon_url text,
  banner_url text,
  created_by text references public.users(id) on delete set null,
  member_count integer not null default 0 check (member_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factions_name_length check (char_length(trim(name)) between 2 and 80),
  constraint factions_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint factions_description_length check (char_length(description) <= 800)
);

create table if not exists public.faction_members (
  id text primary key default gen_random_uuid()::text,
  faction_id text not null references public.factions(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  constraint faction_members_role_allowed check (role in ('member', 'admin', 'founder')),
  constraint faction_members_unique_member unique (faction_id, user_id)
);

create table if not exists public.faction_posts (
  id text primary key default gen_random_uuid()::text,
  faction_id text not null references public.factions(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faction_posts_content_length check (char_length(trim(content)) between 1 and 2000)
);

-- Optional bridge for existing posts so the main feed can later tag posts with factions.
alter table public.posts
  add column if not exists faction_id text references public.factions(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Daily contribution/activity heatmap data
-- -----------------------------------------------------------------------------
create table if not exists public.user_activity_daily (
  user_id text not null references public.users(id) on delete cascade,
  date date not null,
  posts_count integer not null default 0 check (posts_count >= 0),
  comments_count integer not null default 0 check (comments_count >= 0),
  battles_count integer not null default 0 check (battles_count >= 0),
  cred_earned integer not null default 0 check (cred_earned >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists factions_created_by_idx on public.factions(created_by);
create index if not exists factions_member_count_idx on public.factions(member_count desc);
create index if not exists factions_created_at_idx on public.factions(created_at desc);
create index if not exists faction_members_faction_id_idx on public.faction_members(faction_id);
create index if not exists faction_members_user_id_idx on public.faction_members(user_id);
create index if not exists faction_members_role_idx on public.faction_members(role);
create index if not exists faction_posts_faction_created_idx on public.faction_posts(faction_id, created_at desc);
create index if not exists faction_posts_user_created_idx on public.faction_posts(user_id, created_at desc);
create index if not exists posts_faction_id_idx on public.posts(faction_id);
create index if not exists user_activity_daily_user_date_idx on public.user_activity_daily(user_id, date desc);

-- -----------------------------------------------------------------------------
-- Utility helpers and triggers
-- -----------------------------------------------------------------------------
create or replace function public.touch_profile_upgrade_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists factions_touch_updated_at on public.factions;
create trigger factions_touch_updated_at
before update on public.factions
for each row execute function public.touch_profile_upgrade_updated_at();

drop trigger if exists faction_posts_touch_updated_at on public.faction_posts;
create trigger faction_posts_touch_updated_at
before update on public.faction_posts
for each row execute function public.touch_profile_upgrade_updated_at();

drop trigger if exists user_activity_daily_touch_updated_at on public.user_activity_daily;
create trigger user_activity_daily_touch_updated_at
before update on public.user_activity_daily
for each row execute function public.touch_profile_upgrade_updated_at();

create or replace function public.refresh_faction_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_faction_id text;
begin
  v_faction_id := coalesce(new.faction_id, old.faction_id);

  update public.factions f
  set member_count = (
    select count(*)::integer
    from public.faction_members fm
    where fm.faction_id = v_faction_id
  )
  where f.id = v_faction_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists faction_members_refresh_count_insert on public.faction_members;
create trigger faction_members_refresh_count_insert
after insert on public.faction_members
for each row execute function public.refresh_faction_member_count();

drop trigger if exists faction_members_refresh_count_delete on public.faction_members;
create trigger faction_members_refresh_count_delete
after delete on public.faction_members
for each row execute function public.refresh_faction_member_count();

drop trigger if exists faction_members_refresh_count_update on public.faction_members;
create trigger faction_members_refresh_count_update
after update of faction_id on public.faction_members
for each row execute function public.refresh_faction_member_count();

create or replace function public.add_faction_founder_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.faction_members (faction_id, user_id, role)
    values (new.id, new.created_by, 'founder')
    on conflict (faction_id, user_id) do update set role = 'founder';
  end if;

  return new;
end;
$$;

drop trigger if exists factions_add_founder_membership on public.factions;
create trigger factions_add_founder_membership
after insert on public.factions
for each row execute function public.add_faction_founder_membership();

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------
alter table public.factions enable row level security;
alter table public.faction_members enable row level security;
alter table public.faction_posts enable row level security;
alter table public.user_activity_daily enable row level security;

create policy factions_read_authenticated on public.factions
  for select
  to authenticated
  using (true);

create policy factions_insert_self on public.factions
  for insert
  to authenticated
  with check (
    created_by is not null
    and exists (
      select 1 from public.users u
      where u.id = factions.created_by
        and u.auth_uid = (select auth.uid())
    )
  );

create policy factions_update_admin on public.factions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.faction_members fm
      join public.users u on u.id = fm.user_id
      where fm.faction_id = factions.id
        and fm.role in ('admin', 'founder')
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.faction_members fm
      join public.users u on u.id = fm.user_id
      where fm.faction_id = factions.id
        and fm.role in ('admin', 'founder')
        and u.auth_uid = (select auth.uid())
    )
  );

create policy factions_delete_founder on public.factions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.faction_members fm
      join public.users u on u.id = fm.user_id
      where fm.faction_id = factions.id
        and fm.role = 'founder'
        and u.auth_uid = (select auth.uid())
    )
  );

create policy faction_members_read_authenticated on public.faction_members
  for select
  to authenticated
  using (true);

create policy faction_members_join_self on public.faction_members
  for insert
  to authenticated
  with check (
    role = 'member'
    and exists (
      select 1 from public.users u
      where u.id = faction_members.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

create policy faction_members_update_admin on public.faction_members
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.faction_members admin_fm
      join public.users u on u.id = admin_fm.user_id
      where admin_fm.faction_id = faction_members.faction_id
        and admin_fm.role in ('admin', 'founder')
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.faction_members admin_fm
      join public.users u on u.id = admin_fm.user_id
      where admin_fm.faction_id = faction_members.faction_id
        and admin_fm.role in ('admin', 'founder')
        and u.auth_uid = (select auth.uid())
    )
  );

create policy faction_members_leave_or_admin_delete on public.faction_members
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = faction_members.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1
      from public.faction_members admin_fm
      join public.users u on u.id = admin_fm.user_id
      where admin_fm.faction_id = faction_members.faction_id
        and admin_fm.role in ('admin', 'founder')
        and u.auth_uid = (select auth.uid())
    )
  );

create policy faction_posts_read_authenticated on public.faction_posts
  for select
  to authenticated
  using (true);

create policy faction_posts_insert_member on public.faction_posts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.faction_members fm
      join public.users u on u.id = fm.user_id
      where fm.faction_id = faction_posts.faction_id
        and fm.user_id = faction_posts.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

create policy faction_posts_update_owner_or_admin on public.faction_posts
  for update
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = faction_posts.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1
      from public.faction_members fm
      join public.users u on u.id = fm.user_id
      where fm.faction_id = faction_posts.faction_id
        and fm.role in ('admin', 'founder')
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = faction_posts.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1
      from public.faction_members fm
      join public.users u on u.id = fm.user_id
      where fm.faction_id = faction_posts.faction_id
        and fm.role in ('admin', 'founder')
        and u.auth_uid = (select auth.uid())
    )
  );

create policy faction_posts_delete_owner_or_admin on public.faction_posts
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = faction_posts.user_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1
      from public.faction_members fm
      join public.users u on u.id = fm.user_id
      where fm.faction_id = faction_posts.faction_id
        and fm.role in ('admin', 'founder')
        and u.auth_uid = (select auth.uid())
    )
  );

create policy user_activity_daily_read_authenticated on public.user_activity_daily
  for select
  to authenticated
  using (true);

create policy user_activity_daily_insert_self on public.user_activity_daily
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = user_activity_daily.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

create policy user_activity_daily_update_self on public.user_activity_daily
  for update
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = user_activity_daily.user_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = user_activity_daily.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- Realtime support
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.factions;
alter publication supabase_realtime add table public.faction_members;
alter publication supabase_realtime add table public.faction_posts;
alter publication supabase_realtime add table public.user_activity_daily;

alter table public.factions replica identity full;
alter table public.faction_members replica identity full;
alter table public.faction_posts replica identity full;
alter table public.user_activity_daily replica identity full;

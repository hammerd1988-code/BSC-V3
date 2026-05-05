-- Fix audited feed/clickable feature gaps:
-- - ensure post counters referenced by the app exist on upgraded databases
-- - add durable like counter maintenance for post_likes inserts/deletes
-- - keep notification alias writes compatible when only payload/is_read are updated

alter table public.posts
  add column if not exists likes_count integer not null default 0,
  add column if not exists view_count integer not null default 0,
  add column if not exists poll_data jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.notifications
  add column if not exists data jsonb,
  add column if not exists read boolean;

update public.notifications
set
  data = coalesce(data, payload, '{}'::jsonb),
  read = coalesce(read, is_read, false);

alter table public.notifications
  alter column data set default '{}'::jsonb,
  alter column read set default false;

update public.posts
set likes_count = coalesce(likes, 0);

create or replace function public.touch_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
before update on public.posts
for each row execute function public.touch_posts_updated_at();

create or replace function public.sync_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts
    set likes = coalesce(likes, 0) + 1,
        likes_count = coalesce(likes_count, 0) + 1
    where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts
    set likes = greatest(coalesce(likes, 0) - 1, 0),
        likes_count = greatest(coalesce(likes_count, 0) - 1, 0)
    where id = old.post_id;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists post_likes_sync_count on public.post_likes;
create trigger post_likes_sync_count
after insert or delete on public.post_likes
for each row execute function public.sync_post_like_count();

create index if not exists posts_likes_count_idx on public.posts (likes_count desc);
create index if not exists posts_view_count_idx on public.posts (view_count desc);

drop policy if exists posts_insert_self on public.posts;
drop policy if exists "posts authed insert" on public.posts;
drop policy if exists "posts readable by authed" on public.posts;
create policy "posts readable by authed" on public.posts
  for select
  to authenticated
  using ((select auth.role()) = 'authenticated');

create policy posts_insert_self on public.posts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.users u
      where u.id = posts.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists posts_update_owner on public.posts;
drop policy if exists "posts owner update" on public.posts;
create policy posts_update_owner on public.posts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = posts.author_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.id = posts.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists likes_insert_self on public.post_likes;
drop policy if exists likes_delete_self on public.post_likes;
drop policy if exists "likes self" on public.post_likes;
drop policy if exists "likes readable by authed" on public.post_likes;
create policy "likes readable by authed" on public.post_likes
  for select
  to authenticated
  using (true);

create policy likes_insert_self on public.post_likes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.users u
      where u.id = post_likes.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

create policy likes_delete_self on public.post_likes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = post_likes.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists posts_delete_owner on public.posts;
drop policy if exists "posts owner delete" on public.posts;
create policy posts_delete_owner on public.posts
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = posts.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

create or replace function public.sync_notification_alias_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.data is distinct from old.data then
      new.payload := coalesce(new.data, '{}'::jsonb);
    elsif new.payload is distinct from old.payload then
      new.data := coalesce(new.payload, '{}'::jsonb);
    else
      new.payload := coalesce(new.payload, new.data, '{}'::jsonb);
      new.data := coalesce(new.data, new.payload, '{}'::jsonb);
    end if;

    if new.read is distinct from old.read then
      new.is_read := coalesce(new.read, false);
    elsif new.is_read is distinct from old.is_read then
      new.read := coalesce(new.is_read, false);
    else
      new.is_read := coalesce(new.is_read, new.read, false);
      new.read := coalesce(new.read, new.is_read, false);
    end if;
  else
    if new.data is not null and (new.payload is null or new.payload = '{}'::jsonb) then
      new.payload := new.data;
    else
      new.payload := coalesce(new.payload, new.data, '{}'::jsonb);
    end if;
    new.data := coalesce(new.data, new.payload, '{}'::jsonb);

    if coalesce(new.read, false) = true then
      new.is_read := true;
    elsif coalesce(new.is_read, false) = true then
      new.read := true;
    else
      new.is_read := false;
      new.read := false;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_notification_alias_fields on public.notifications;
create trigger trg_sync_notification_alias_fields
before insert or update on public.notifications
for each row execute function public.sync_notification_alias_fields();
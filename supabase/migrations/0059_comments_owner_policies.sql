-- Reconcile public.comments RLS with production.
--
-- 0004 and 0005 `alter` policies named comments_insert_self and
-- comments_delete_owner, but no migration ever creates them — they exist only
-- in the live database. A fresh `supabase db reset` therefore produces a
-- comments table with only the two 0001 policies ("comments readable by authed"
-- and "comments authed insert"), no owner-scoped insert, and — because RLS is
-- deny-by-default — no way at all to edit or delete a comment.
--
-- This migration defines the full owner-scoped policy set idempotently so a
-- rebuilt database matches production and authors can manage their own rows.

alter table public.comments enable row level security;

-- Superseded by the owner-scoped policies below.
drop policy if exists "comments authed insert" on public.comments;

drop policy if exists comments_select_authed on public.comments;
drop policy if exists "comments readable by authed" on public.comments;
create policy comments_select_authed on public.comments
  for select
  to authenticated
  using (true);

drop policy if exists comments_insert_self on public.comments;
create policy comments_insert_self on public.comments
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = comments.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists comments_update_owner on public.comments;
create policy comments_update_owner on public.comments
  for update
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = comments.author_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = comments.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists comments_delete_owner on public.comments;
create policy comments_delete_owner on public.comments
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = comments.author_id
        and u.auth_uid = (select auth.uid())
    )
    or exists (
      select 1 from public.users u
      where u.auth_uid = (select auth.uid())
        and u.role in ('admin', 'moderator')
    )
  );

-- Drop the bot-compatibility branch from the comments insert policy.
--
-- 0059 admitted rows authored by `type = 'bot' and auth_uid is null` so the
-- browser-side bot reply in CommentsModal would keep working. Every bot row in
-- the live database has `auth_uid` populated, so the branch matched nothing and
-- bot replies failed anyway. Bot replies now go through
-- POST /api/comments/bot-reply, which writes with the service-role key, so the
-- policy can be strictly owner-scoped — which also removes the client-side bot
-- impersonation path the branch was going to leave open.

drop policy if exists comments_insert_self on public.comments;

create policy comments_insert_self on public.comments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.users u
      where u.id = comments.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

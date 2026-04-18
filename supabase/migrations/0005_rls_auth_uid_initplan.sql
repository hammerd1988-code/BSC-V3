-- Explicitly rewrite RLS predicates to use initplans:
-- auth.uid() -> (select auth.uid())

alter policy users_insert_self on public.users
  with check ((select auth.uid()) = auth_uid);

alter policy users_update_self on public.users
  using ((select auth.uid()) = auth_uid);

alter policy posts_delete_owner on public.posts
  using (
    exists (
      select 1
      from users u
      where u.id = posts.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy posts_insert_self on public.posts
  with check (
    exists (
      select 1
      from users u
      where u.id = posts.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy posts_update_owner on public.posts
  using (
    exists (
      select 1
      from users u
      where u.id = posts.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy comments_delete_owner on public.comments
  using (
    exists (
      select 1
      from users u
      where u.id = comments.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy comments_insert_self on public.comments
  with check (
    exists (
      select 1
      from users u
      where u.id = comments.author_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy likes_delete_self on public.post_likes
  using (
    exists (
      select 1
      from users u
      where u.id = post_likes.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy likes_insert_self on public.post_likes
  with check (
    exists (
      select 1
      from users u
      where u.id = post_likes.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy tx_read_participants on public.transmissions
  using (
    exists (
      select 1
      from users u
      where u.auth_uid = (select auth.uid())
        and u.id = any (transmissions.participant_ids)
    )
  );

alter policy tx_write_participants on public.transmissions
  using (
    exists (
      select 1
      from users u
      where u.auth_uid = (select auth.uid())
        and u.id = any (transmissions.participant_ids)
    )
  );

alter policy transmits_participants on public.transmits
  using (
    exists (
      select 1
      from transmissions t
      join users u on u.auth_uid = (select auth.uid())
      where t.id = transmits.transmission_id
        and u.id = any (t.participant_ids)
    )
  );

alter policy streams_host_write on public.streams
  using (
    exists (
      select 1
      from users u
      where u.id = streams.host_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy schat_insert_self on public.stream_chat
  with check (
    exists (
      select 1
      from users u
      where u.id = stream_chat.sender_id
        and u.auth_uid = (select auth.uid())
    )
  );

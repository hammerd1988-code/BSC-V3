-- Explicitly rewrite RLS predicates to use initplans:
-- auth.uid() -> (select auth.uid())
--
-- None of the policy names below are created by any migration — they were
-- introduced directly against the live database, so a bare `alter policy`
-- aborts the whole run on a fresh `supabase db reset`. Each statement is
-- guarded to no-op when its policy is absent; the authoritative definitions
-- live in the later migrations that create them.

do $$
begin
  alter policy users_insert_self on public.users
    with check ((select auth.uid()) = auth_uid);
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy users_update_self on public.users
    using ((select auth.uid()) = auth_uid);
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy posts_delete_owner on public.posts
    using (
      exists (
        select 1
        from users u
        where u.id = posts.author_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy posts_insert_self on public.posts
    with check (
      exists (
        select 1
        from users u
        where u.id = posts.author_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy posts_update_owner on public.posts
    using (
      exists (
        select 1
        from users u
        where u.id = posts.author_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy comments_delete_owner on public.comments
    using (
      exists (
        select 1
        from users u
        where u.id = comments.author_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy comments_insert_self on public.comments
    with check (
      exists (
        select 1
        from users u
        where u.id = comments.author_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy likes_delete_self on public.post_likes
    using (
      exists (
        select 1
        from users u
        where u.id = post_likes.user_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy likes_insert_self on public.post_likes
    with check (
      exists (
        select 1
        from users u
        where u.id = post_likes.user_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy tx_read_participants on public.transmissions
    using (
      exists (
        select 1
        from users u
        where u.auth_uid = (select auth.uid())
          and u.id = any (transmissions.participant_ids)
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy tx_write_participants on public.transmissions
    using (
      exists (
        select 1
        from users u
        where u.auth_uid = (select auth.uid())
          and u.id = any (transmissions.participant_ids)
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
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
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy streams_host_write on public.streams
    using (
      exists (
        select 1
        from users u
        where u.id = streams.host_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

do $$
begin
  alter policy schat_insert_self on public.stream_chat
    with check (
      exists (
        select 1
        from users u
        where u.id = stream_chat.sender_id
          and u.auth_uid = (select auth.uid())
      )
    );
exception when undefined_object then
  null;
end $$;

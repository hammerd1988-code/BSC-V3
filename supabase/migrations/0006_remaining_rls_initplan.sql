-- Resolve remaining auth_rls_initplan warnings.

alter policy bounties_insert_self on public.bounties
  with check (
    exists (
      select 1
      from users u
      where u.id = bounties.creator_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy bounties_update_creator on public.bounties
  using (
    exists (
      select 1
      from users u
      where u.id = bounties.creator_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy tx_insert_owner on public.transactions
  with check (
    exists (
      select 1
      from users u
      where u.id = transactions.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy tx_read_owner on public.transactions
  using (
    exists (
      select 1
      from users u
      where u.id = transactions.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy notif_insert_owner on public.notifications
  with check (
    exists (
      select 1
      from users u
      where u.id = notifications.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy notif_read_owner on public.notifications
  using (
    exists (
      select 1
      from users u
      where u.id = notifications.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy notif_update_owner on public.notifications
  using (
    exists (
      select 1
      from users u
      where u.id = notifications.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

alter policy follows_insert on public.follows
  with check (
    follower_id = (
      select users.id
      from users
      where users.auth_uid = (select auth.uid())
    )
  );

alter policy follows_delete on public.follows
  using (
    follower_id = (
      select users.id
      from users
      where users.auth_uid = (select auth.uid())
    )
  );

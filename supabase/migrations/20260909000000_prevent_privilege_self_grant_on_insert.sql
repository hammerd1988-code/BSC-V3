-- Extend the 0060 self-escalation guard to INSERT, and make one auth identity
-- own at most one profile row.
--
-- 0060 pins users.role on UPDATE, and 0068's header states that "role
-- self-escalation stays blocked by the 0060 trigger". That only holds for
-- UPDATE. `users self-insert` (0001) is `with check (auth.uid() = auth_uid)`
-- with no column restriction, users.auth_uid carries only a plain index, and
-- nothing caps a caller at one row -- so any signed-in account could INSERT an
-- extra profile row carrying its own auth_uid and role = 'admin'.
--
-- One such row is enough to become an administrator: is_admin_user() (0068) is
-- `exists (... where auth_uid = auth.uid() and role = 'admin')`, so
-- users_admin_update then grants UPDATE on every other account's row, the
-- casper_config admin policies open, and the server's own admin gate resolves a
-- profile with `.eq('auth_uid', ...).limit(1)`, which a duplicate turns into a
-- coin flip between the real row and the planted one.
--
-- Operator note: this closes the door but does not undo an escalation that
-- already happened. Audit for it with
--   select auth_uid, count(*) from public.users
--   where auth_uid is not null group by auth_uid having count(*) > 1;
-- and review any role = 'admin' row whose auth_uid also owns a non-admin row.

create or replace function public.enforce_role_insert_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
begin
  -- No end-user JWT: the service role, the SQL editor, or a definer function
  -- running outside a request. Those are the trusted seeding paths (bot
  -- personas, Stripe, the migration chain itself).
  if _actor is null then
    return new;
  end if;

  if public.is_admin_user() then
    return new;
  end if;

  -- Elevated roles are granted by an admin through UPDATE, where the 0060
  -- trigger governs the transition.
  new.role := 'user';
  return new;
end;
$$;

drop trigger if exists users_enforce_role_insert_authority on public.users;
create trigger users_enforce_role_insert_authority
  before insert on public.users
  for each row
  execute function public.enforce_role_insert_authority();

-- Structural half of the fix: one profile per auth identity. This also makes
-- the `.eq('auth_uid', ...).limit(1)` profile lookup the whole server relies on
-- deterministic.
--
-- Guarded rather than unconditional: a live project that already carries
-- duplicate auth_uid rows would abort the whole migration on a bare
-- `create unique index`, and reconciling identities is an operator decision --
-- never something a migration should resolve by deleting rows. The trigger
-- above closes the escalation either way.
do $$
declare
  _duplicates text;
begin
  select string_agg(auth_uid::text || ' x' || row_count::text, ', ')
    into _duplicates
  from (
    select auth_uid, count(*) as row_count
    from public.users
    where auth_uid is not null
    group by auth_uid
    having count(*) > 1
  ) d;

  if _duplicates is null then
    create unique index if not exists users_auth_uid_key
      on public.users (auth_uid)
      where auth_uid is not null;
    -- Superseded by the unique index above.
    drop index if exists public.users_auth_uid_idx;
  else
    raise warning 'public.users holds duplicate auth_uid rows, so users_auth_uid_key was not created. Reconcile these identities and re-run this migration: %', _duplicates;
  end if;
end;
$$;

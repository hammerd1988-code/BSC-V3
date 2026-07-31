-- Stop clients from granting themselves privileges.
--
-- `users self-update` (0001) lets a signed-in account update every column of
-- its own row, `role` included, so any user could set role = 'admin' with a
-- single PostgREST call. RLS cannot express a column-level restriction, so a
-- before-update trigger pins `role` unless the actor is already an admin or
-- the statement runs without an end-user JWT (service role / SQL editor).

create or replace function public.enforce_role_change_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _actor_role text;
begin
  if new.role is distinct from old.role and _actor is not null then
    select u.role into _actor_role
    from public.users u
    where u.auth_uid = _actor;

    if coalesce(_actor_role, 'user') <> 'admin' then
      new.role := old.role;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists users_enforce_role_change_authority on public.users;
create trigger users_enforce_role_change_authority
  before update of role on public.users
  for each row
  execute function public.enforce_role_change_authority();

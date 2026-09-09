-- Make Local Coder license key rotation atomic.
--
-- `POST /api/license/key` with `{ rotate: true }` used to revoke the live key in
-- one Supabase request and insert its replacement in a second one:
--
--     update license_keys set revoked_at = now() where id = existing.id   -- (1)
--     insert into license_keys (user_id, key, label) values (...)         -- (2)
--
-- If (2) failed after (1) committed — a transient connection drop, a statement
-- timeout, the partial unique index below rejecting a concurrent rotation — the
-- route answered 500 "Failed to create license key." while the account was left
-- with *no* live key at all. The caller is told the rotation did not happen, so
-- it keeps using the old key, and every `GET /api/license/verify` from that
-- Local Coder install now 401s until someone thinks to rotate again.
--
-- Doing both statements inside one function body puts them in one transaction,
-- so the pair either both apply or neither does. That also makes two concurrent
-- rotations resolve correctly rather than destructively: the second one blocks
-- on the first's row lock, re-checks `revoked_at is null` (now false, so it
-- revokes nothing), then trips the partial unique index on insert and rolls
-- back — leaving the winner's key live instead of wiping both.
--
-- security invoker, and execute is withheld from anon/authenticated: only the
-- server (service role) mints keys, and `license_keys` deliberately carries no
-- RLS insert/update policy, so an invoker-rights call from a browser session
-- would be refused by RLS even if the grant were widened by accident.

create or replace function public.rotate_license_key(
    p_user_id  text,
    p_key_hash text,
    p_label    text default 'local-coder'
) returns table (
    license_id         uuid,
    license_created_at timestamptz,
    replaced_previous  boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_replaced boolean := false;
begin
    if coalesce(p_user_id, '') = '' or coalesce(p_key_hash, '') = '' then
        raise exception 'rotate_license_key requires a user id and a key hash';
    end if;

    update public.license_keys
       set revoked_at = now()
     where user_id = p_user_id
       and label = coalesce(p_label, 'local-coder')
       and revoked_at is null;

    v_replaced := found;

    insert into public.license_keys (user_id, key, label)
    values (p_user_id, p_key_hash, coalesce(p_label, 'local-coder'))
    returning id, created_at into license_id, license_created_at;

    replaced_previous := v_replaced;
    return next;
end;
$$;

-- No blanket PUBLIC execute: a caller that appears later should fail loudly
-- rather than inherit whatever the default grant happens to be.
revoke all on function public.rotate_license_key(text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.rotate_license_key(text, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.rotate_license_key(text, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.rotate_license_key(text, text, text) to service_role;
  end if;
end;
$$;

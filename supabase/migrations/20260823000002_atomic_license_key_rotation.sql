-- Rotate a Local Coder license key in one transaction.
--
-- The route revoked the active row in one Supabase request and inserted its
-- replacement in a second. Those are separate transactions, so a failure
-- between them (connection drop, statement timeout, PostgREST restart) left the
-- account with no active key while the API reported that rotation had failed —
-- the caller retried against a state that no longer matched the error they were
-- given, and the Local Coder install had already stopped verifying.
--
-- Doing both here means the revoke is only durable if the replacement lands.
-- `license_keys_one_active_per_user_label_idx` (one active row per user/label)
-- also makes insert-then-revoke impossible to express as two statements in the
-- other order, so a function is the only way to get atomicity.

create or replace function public.rotate_license_key(
  p_user_id text,
  p_label text,
  p_key_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_revoked boolean := false;
begin
  -- Lock the caller's active row so two concurrent rotations serialise instead
  -- of both revoking and then colliding on the unique partial index.
  perform 1
  from public.license_keys
  where user_id = p_user_id
    and label = p_label
    and revoked_at is null
  for update;

  update public.license_keys
     set revoked_at = now()
   where user_id = p_user_id
     and label = p_label
     and revoked_at is null;

  v_revoked := found;

  insert into public.license_keys (user_id, key, label)
  values (p_user_id, p_key_hash, p_label);

  return v_revoked;
end;
$$;

-- Minting is a service-role operation: the route authenticates the JWT, resolves
-- the profile, and calls this with the service key. A client reaching it
-- directly could mint a key for any user_id it named.
revoke all on function public.rotate_license_key(text, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.rotate_license_key(text, text, text) to service_role;
  end if;
end;
$$;

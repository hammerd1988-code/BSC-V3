-- Make Local Coder license-key rotation atomic.
--
-- POST /api/license/key rotated a key with two independent Supabase requests:
-- an UPDATE that revoked the active row, then an INSERT that minted its
-- replacement. Anything that failed between them — a dropped connection, the
-- insert being rejected — left the account with no active key at all while the
-- API reported the rotation as failed. The owner's Local Coder install then
-- stopped verifying and there was no key left to fall back to.
--
-- Both steps now happen inside one function, so they commit or roll back
-- together. A per-(user, label) advisory lock serialises concurrent rotations
-- so two in-flight requests cannot race each other into the one-active-key
-- partial unique index.

create or replace function public.mint_license_key(
  p_user_id text,
  p_label text,
  p_key_hash text,
  p_rotate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing_id uuid;
begin
  if p_user_id is null or p_label is null or p_key_hash is null then
    raise exception 'mint_license_key: p_user_id, p_label and p_key_hash are required';
  end if;

  -- Held until this transaction commits, so the revoke and the insert below
  -- are the only pair of statements touching this user's active key.
  perform pg_advisory_xact_lock(hashtext(p_user_id || ':' || p_label));

  select id
    into v_existing_id
    from public.license_keys
   where user_id = p_user_id
     and label = p_label
     and revoked_at is null;

  -- No rotation requested and a key already exists: report it without minting,
  -- since the caller cannot be shown a key it no longer has the plaintext for.
  if v_existing_id is not null and not coalesce(p_rotate, false) then
    return jsonb_build_object('minted', false, 'rotated', false, 'had_key', true);
  end if;

  if v_existing_id is not null then
    update public.license_keys
       set revoked_at = now()
     where id = v_existing_id;
  end if;

  insert into public.license_keys (user_id, key, label)
  values (p_user_id, p_key_hash, p_label);

  return jsonb_build_object(
    'minted', true,
    'rotated', v_existing_id is not null,
    'had_key', v_existing_id is not null
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mint_license_key(text, text, text, boolean) to service_role;
  end if;
end;
$$;

-- Issues a bearer credential; keep it off the end-user roles.
revoke all on function public.mint_license_key(text, text, text, boolean) from public;

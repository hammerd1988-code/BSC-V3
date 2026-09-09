-- Backfill any plaintext Local Coder keys and issue future keys atomically.
--
-- PR #313 initially wrote bearer keys directly into `license_keys.key`, then a
-- later code change switched verify() to compare SHA-256 hashes. Existing rows
-- created before that fix must be backfilled or those licenses stop verifying.
-- Rotation also needs to revoke the old row and insert the replacement inside a
-- single transaction so a failed insert cannot leave an account without a key.

update public.license_keys
   set key = encode(digest(key, 'sha256'), 'hex')
 where key like 'bsc\_%' escape '\';

create or replace function public.issue_license_key(
    p_user_id text,
    p_label   text default 'local-coder'
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_key text := 'bsc_' || encode(gen_random_bytes(24), 'hex');
  v_revoked_count bigint := 0;
begin
  update public.license_keys
     set revoked_at = now()
   where user_id = p_user_id
     and label = p_label
     and revoked_at is null;

  get diagnostics v_revoked_count = row_count;

  insert into public.license_keys (user_id, key, label)
  values (p_user_id, encode(digest(v_key, 'sha256'), 'hex'), p_label);

  return jsonb_build_object(
    'key', v_key,
    'rotated', v_revoked_count > 0
  );
end;
$$;

revoke all on function public.issue_license_key(text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.issue_license_key(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.issue_license_key(text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.issue_license_key(text, text) to service_role;
  end if;
end;
$$;
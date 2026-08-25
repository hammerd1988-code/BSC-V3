-- License keys linking external Local Coder installs to a BSC account.
-- Keys are minted and verified server-side (service role); the verify endpoint
-- resolves the owner's subscription tier to gate Local Coder Pro features.

create extension if not exists "pgcrypto";

create table if not exists public.license_keys (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  key text not null unique,
  label text not null default 'local-coder',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

-- One live key per user/label; revoked rows are kept for auditing.
create unique index if not exists license_keys_one_active_per_user_label_idx
  on public.license_keys (user_id, label)
  where revoked_at is null;

create index if not exists license_keys_user_idx on public.license_keys (user_id);

alter table public.license_keys enable row level security;

-- Owners may read their own keys; all writes go through the server (service role).
drop policy if exists license_keys_owner_read on public.license_keys;
create policy license_keys_owner_read on public.license_keys
  for select to authenticated using (
    exists (
      select 1 from public.users u
      where u.id = license_keys.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

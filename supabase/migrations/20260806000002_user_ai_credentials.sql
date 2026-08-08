-- Move the per-user LLM API key out of users.ai_settings.
--
-- Edit Profile → AI Settings and the Casper Cognitive Core both write
-- `ai_settings.apiKey` — a provider credential the user pays for — into the
-- users table. `users readable by authed` is `using (auth.role() =
-- 'authenticated')` with no column restriction and every client read is
-- `select('*')`, so each signed-in account can read every other account's key.
-- This is the same hazard 0014 handled for gladiators.api_key with column
-- grants, but that trick cannot work here: a column-level grant makes
-- `select *` fail outright, and the whole app selects users that way.
--
-- So the secret moves to its own table, owner-scoped by RLS, and a trigger
-- strips it back out of ai_settings on the way in. The trigger matters as much
-- as the table: a cached older bundle keeps sending the key, and without it the
-- column silently refills.

create table if not exists public.user_ai_credentials (
    user_id    text primary key references public.users(id) on delete cascade,
    api_key    text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.user_ai_credentials enable row level security;

create or replace function public.touch_user_ai_credentials_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_ai_credentials_touch_updated_at on public.user_ai_credentials;
create trigger user_ai_credentials_touch_updated_at
before update on public.user_ai_credentials
for each row execute function public.touch_user_ai_credentials_updated_at();

-- users.id is text and only equals auth.uid() for profiles this client created;
-- migrated rows are matched through auth_uid, so ownership is resolved the same
-- way the posts and post_likes policies do it.
drop policy if exists user_ai_credentials_owner_select on public.user_ai_credentials;
create policy user_ai_credentials_owner_select on public.user_ai_credentials
  for select
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = user_ai_credentials.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists user_ai_credentials_owner_insert on public.user_ai_credentials;
create policy user_ai_credentials_owner_insert on public.user_ai_credentials
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = user_ai_credentials.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists user_ai_credentials_owner_update on public.user_ai_credentials;
create policy user_ai_credentials_owner_update on public.user_ai_credentials
  for update
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = user_ai_credentials.user_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = user_ai_credentials.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists user_ai_credentials_owner_delete on public.user_ai_credentials;
create policy user_ai_credentials_owner_delete on public.user_ai_credentials
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = user_ai_credentials.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

-- anon has no business here at all; 0000 grants the API roles by default so the
-- revoke has to be explicit.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.user_ai_credentials from anon;
  end if;
end;
$$;

-- Carry across whatever is already stored, then take it out of the shared row.
insert into public.user_ai_credentials (user_id, api_key)
select u.id, coalesce(nullif(u.ai_settings->>'apiKey', ''), nullif(u.ai_settings->>'api_key', ''))
from public.users u
where jsonb_typeof(u.ai_settings) = 'object'
  and coalesce(nullif(u.ai_settings->>'apiKey', ''), nullif(u.ai_settings->>'api_key', '')) is not null
on conflict (user_id) do nothing;

update public.users
set ai_settings = (ai_settings - 'apiKey') - 'api_key'
where jsonb_typeof(ai_settings) = 'object'
  and (ai_settings ? 'apiKey' or ai_settings ? 'api_key');

create or replace function public.strip_ai_settings_secret()
returns trigger
language plpgsql
as $$
begin
  if jsonb_typeof(new.ai_settings) = 'object'
     and (new.ai_settings ? 'apiKey' or new.ai_settings ? 'api_key') then
    new.ai_settings := (new.ai_settings - 'apiKey') - 'api_key';
  end if;
  return new;
end;
$$;

drop trigger if exists users_strip_ai_settings_secret on public.users;
create trigger users_strip_ai_settings_secret
before insert or update on public.users
for each row execute function public.strip_ai_settings_secret();

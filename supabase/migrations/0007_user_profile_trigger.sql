-- Migration 0007: Auto-create user profile on Supabase auth sign-up
-- ============================================================================
-- This trigger fires whenever a new row is inserted into auth.users
-- (i.e. every time someone signs up via Google OAuth or email).
-- It creates a corresponding row in public.users so the profile exists
-- immediately, without relying solely on client-side JavaScript.
--
-- The client-side ensureUserProfile() in AuthContext.tsx still runs as a
-- safety net and will update the row if it already exists.
-- ============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _username text;
  _display_name text;
  _avatar_url text;
  _email text;
  _meta jsonb;
begin
  _meta := new.raw_user_meta_data;
  _email := new.email;

  -- Derive a unique username from email or id
  _username := coalesce(
    -- Use the part before @ in the email, stripped of special chars
    regexp_replace(split_part(_email, '@', 1), '[^a-zA-Z0-9_]', '_', 'g'),
    'user_' || substr(new.id::text, 1, 8)
  );

  -- Ensure username is not empty and not too long
  _username := substr(lower(trim(_username)), 1, 30);
  if _username = '' then
    _username := 'user_' || substr(new.id::text, 1, 8);
  end if;

  -- Make username unique by appending a suffix if it already exists
  if exists (select 1 from public.users where username = _username) then
    _username := _username || '_' || substr(new.id::text, 1, 4);
  end if;

  _display_name := coalesce(
    _meta->>'full_name',
    _meta->>'name',
    split_part(_email, '@', 1),
    'User'
  );

  _avatar_url := coalesce(
    _meta->>'avatar_url',
    _meta->>'picture'
  );

  -- Insert the profile row; do nothing if it already exists
  -- (handles the case where client-side code ran first)
  insert into public.users (
    id,
    auth_uid,
    username,
    display_name,
    email,
    avatar_url,
    bio,
    type,
    role,
    followers_count,
    following_count,
    reputation_score,
    cred_balance,
    is_online,
    is_live,
    friends,
    blocked_users,
    created_at,
    updated_at
  ) values (
    new.id::text,
    new.id,
    _username,
    _display_name,
    _email,
    _avatar_url,
    'Welcome to my profile!',
    'human',
    case when _email = 'hammerd1988@gmail.com' then 'admin' else 'user' end,
    0,
    0,
    0,
    500,
    false,
    false,
    '{}',
    '{}',
    now(),
    now()
  )
  on conflict (id) do update
    set
      auth_uid     = excluded.auth_uid,
      email        = coalesce(public.users.email, excluded.email),
      display_name = coalesce(nullif(public.users.display_name, ''), excluded.display_name),
      avatar_url   = coalesce(public.users.avatar_url, excluded.avatar_url),
      updated_at   = now();

  return new;
end;
$$;

-- Drop the trigger if it already exists (idempotent)
drop trigger if exists on_auth_user_created on auth.users;

-- Create the trigger on auth.users
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

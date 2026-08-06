-- Repair schema drift: columns, functions and constraints the application has
-- written to for a long time but that no migration ever created.
--
-- Every item below is the same class of bug as users.onboarding_complete (0062):
-- PostgREST rejects an *entire* payload when it names an unknown column, so each
-- missing column silently broke its feature and also discarded the valid sibling
-- fields sent in the same insert/update.

-- -------------------------------------------------------------------------
-- transmits.receiver_id
--
-- 0017 created transmits_seen_idx on (receiver_id, seen_at) but never added the
-- column, so a database built from scratch fails at 0017 and every direct
-- message insert (which always sends receiver_id) is rejected.
-- -------------------------------------------------------------------------
alter table public.transmits
  add column if not exists receiver_id text references public.users(id) on delete cascade;

-- Backfill from the thread's participants: a transmit's receiver is the
-- participant that is not the sender.
update public.transmits t
   set receiver_id = sub.receiver_id
  from (
    select tr.id,
           (
             select p
               from unnest(tx.participant_ids) as p
              where p <> tr.sender_id
              limit 1
           ) as receiver_id
      from public.transmits tr
      join public.transmissions tx on tx.id = tr.transmission_id
     where tr.receiver_id is null
  ) as sub
 where t.id = sub.id
   and t.receiver_id is null
   and sub.receiver_id is not null;

create index if not exists transmits_receiver_idx on public.transmits (receiver_id, created_at desc);
-- Recreate 0017's index for databases where that statement could not run.
create index if not exists transmits_seen_idx on public.transmits (receiver_id, seen_at) where seen_at is null;

-- -------------------------------------------------------------------------
-- users: social graph, streaks, referrals and profile customisation
-- -------------------------------------------------------------------------
alter table public.users
  add column if not exists friend_requests jsonb not null default '[]'::jsonb,
  add column if not exists current_streak integer not null default 0,
  add column if not exists longest_streak integer not null default 0,
  add column if not exists last_active_date date,
  add column if not exists referral_count integer not null default 0,
  add column if not exists profile_theme jsonb,
  add column if not exists profile_sections jsonb,
  add column if not exists profile_music_url text,
  add column if not exists profile_music_title text,
  add column if not exists profile_music_artist text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_friend_requests_is_array'
  ) then
    alter table public.users
      add constraint users_friend_requests_is_array
      check (jsonb_typeof(friend_requests) = 'array');
  end if;
end;
$$;

-- referral_count was read but never maintained; seed it from the ledger.
update public.users u
   set referral_count = r.cnt
  from (
    select referrer_id, count(*)::integer as cnt
      from public.referrals
     group by referrer_id
  ) as r
 where r.referrer_id = u.id
   and u.referral_count <> r.cnt;

-- -------------------------------------------------------------------------
-- Friend requests need to touch the *other* user's row, which the
-- "users self-update" RLS policy (0001) forbids. Move the mutations into
-- security-definer functions so they are both permitted and atomic: the old
-- client-side read-modify-write also lost concurrent requests.
-- -------------------------------------------------------------------------
create or replace function public.send_friend_request(p_target_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.users;
begin
  select * into v_actor from public.users where auth_uid = auth.uid() limit 1;
  if v_actor.id is null then
    raise exception 'send_friend_request: no profile for the current session';
  end if;
  if v_actor.id = p_target_id then
    raise exception 'send_friend_request: cannot link to yourself';
  end if;
  if not exists (select 1 from public.users where id = p_target_id) then
    raise exception 'send_friend_request: target user does not exist';
  end if;
  if p_target_id = any (coalesce(v_actor.friends, '{}')) then
    return; -- already linked
  end if;

  update public.users t
     set friend_requests = coalesce(t.friend_requests, '[]'::jsonb) || jsonb_build_object(
           'from_id', v_actor.id,
           'from_username', v_actor.username,
           'from_display_name', v_actor.display_name,
           'from_avatar_url', v_actor.avatar_url,
           'sent_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
         )
   where t.id = p_target_id
     and not exists (
       select 1
         from jsonb_array_elements(coalesce(t.friend_requests, '[]'::jsonb)) as pending
        where pending->>'from_id' = v_actor.id
     );
end;
$$;

create or replace function public.cancel_friend_request(p_target_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id text;
begin
  select id into v_actor_id from public.users where auth_uid = auth.uid() limit 1;
  if v_actor_id is null then
    raise exception 'cancel_friend_request: no profile for the current session';
  end if;

  update public.users t
     set friend_requests = coalesce((
           select jsonb_agg(pending)
             from jsonb_array_elements(coalesce(t.friend_requests, '[]'::jsonb)) as pending
            where pending->>'from_id' is distinct from v_actor_id
         ), '[]'::jsonb)
   where t.id = p_target_id;
end;
$$;

create or replace function public.respond_friend_request(p_from_id text, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id text;
begin
  select id into v_actor_id from public.users where auth_uid = auth.uid() limit 1;
  if v_actor_id is null then
    raise exception 'respond_friend_request: no profile for the current session';
  end if;

  -- Drop the pending request from the recipient (the caller) either way.
  update public.users t
     set friend_requests = coalesce((
           select jsonb_agg(pending)
             from jsonb_array_elements(coalesce(t.friend_requests, '[]'::jsonb)) as pending
            where pending->>'from_id' is distinct from p_from_id
         ), '[]'::jsonb),
         friends = case
           when coalesce(p_accept, false) and not (p_from_id = any (coalesce(t.friends, '{}')))
             then coalesce(t.friends, '{}') || p_from_id
           else t.friends
         end
   where t.id = v_actor_id;

  if coalesce(p_accept, false) then
    update public.users t
       set friends = case
             when not (v_actor_id = any (coalesce(t.friends, '{}')))
               then coalesce(t.friends, '{}') || v_actor_id
             else t.friends
           end
     where t.id = p_from_id;
  end if;
end;
$$;

create or replace function public.remove_friend(p_friend_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id text;
begin
  select id into v_actor_id from public.users where auth_uid = auth.uid() limit 1;
  if v_actor_id is null then
    raise exception 'remove_friend: no profile for the current session';
  end if;

  update public.users set friends = array_remove(coalesce(friends, '{}'), p_friend_id) where id = v_actor_id;
  update public.users set friends = array_remove(coalesce(friends, '{}'), v_actor_id) where id = p_friend_id;
end;
$$;

-- -------------------------------------------------------------------------
-- CRED economy functions the payment routes have always called.
-- Both were missing, so /api/square/process-payment charged the card and then
-- returned 500 without ever crediting CRED, and /api/cred/exchange always 500'd.
-- -------------------------------------------------------------------------
create or replace function public.increment_cred_balance(p_user_id text, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_balance integer;
begin
  if p_amount is null then
    raise exception 'increment_cred_balance: p_amount is required';
  end if;

  update public.users u
     set cred_balance = greatest(coalesce(u.cred_balance, 0) + p_amount, 0),
         updated_at = now()
   where u.id::text = p_user_id
  returning u.cred_balance into v_balance;

  if v_balance is null then
    raise exception 'increment_cred_balance: user % not found', p_user_id;
  end if;

  return v_balance;
end;
$$;

-- Returns jsonb rather than a typed row so the OUT names cannot collide with the
-- users columns of the same name inside the function body.
create or replace function public.exchange_cred_for_tokens(
  user_id text,
  cred_to_deduct integer,
  tokens_to_add integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id text := user_id;
  v_cred integer := cred_to_deduct;
  v_tokens integer := tokens_to_add;
  v_result jsonb;
begin
  if v_cred is null or v_cred <= 0 then
    raise exception 'exchange_cred_for_tokens: cred_to_deduct must be positive';
  end if;
  if v_tokens is null or v_tokens < 0 then
    raise exception 'exchange_cred_for_tokens: tokens_to_add must not be negative';
  end if;

  -- Single guarded statement so a concurrent exchange cannot overdraw the balance.
  update public.users u
     set cred_balance = u.cred_balance - v_cred,
         compute_tokens = coalesce(u.compute_tokens, 0) + v_tokens,
         updated_at = now()
   where u.id::text = v_user_id
     and coalesce(u.cred_balance, 0) >= v_cred
  returning jsonb_build_object(
    'cred_balance', u.cred_balance,
    'compute_tokens', u.compute_tokens
  ) into v_result;

  if v_result is null then
    raise exception 'exchange_cred_for_tokens: insufficient CRED or unknown user %', v_user_id
      using errcode = '22023';
  end if;

  return v_result;
end;
$$;

create or replace function public.increment_gladiator_wins(gladiator_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.gladiators g
     set wins = coalesce(g.wins, 0) + 1
   where g.id::text = gladiator_id;
end;
$$;

-- -------------------------------------------------------------------------
-- casper_tasks: the local-LLM handoff parks a task in 'awaiting_client',
-- which the 0018 CHECK constraint rejected.
-- -------------------------------------------------------------------------
alter table public.casper_tasks drop constraint if exists casper_tasks_status_check;
alter table public.casper_tasks
  add constraint casper_tasks_status_check
  check (status in ('pending', 'running', 'completed', 'failed', 'awaiting_client'));

-- -------------------------------------------------------------------------
-- transactions.type: /api/cred/exchange writes 'exchange' and
-- convert_cred_to_compute() (0029) writes 'convert', neither of which the 0001
-- CHECK allowed, so both ledger rows were rejected after the balance had
-- already moved. Databases where type is an enum get the labels instead.
-- -------------------------------------------------------------------------
do $$
declare
  v_type text;
  v_label text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_type
    from pg_attribute a
   where a.attrelid = 'public.transactions'::regclass
     and a.attname = 'type'
     and a.attnum > 0
     and not a.attisdropped;

  if v_type = 'text' then
    alter table public.transactions drop constraint if exists transactions_type_check;
    alter table public.transactions
      add constraint transactions_type_check
      check (type in ('spend', 'earn', 'purchase', 'convert', 'exchange', 'refund'));
  else
    foreach v_label in array array['convert', 'exchange', 'refund'] loop
      execute format('alter type %s add value if not exists %L', v_type, v_label);
    end loop;
  end if;
end;
$$;

-- -------------------------------------------------------------------------
-- Grants (skipped on plain Postgres, which has no Supabase roles).
-- -------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.send_friend_request(text) to authenticated;
    grant execute on function public.cancel_friend_request(text) to authenticated;
    grant execute on function public.respond_friend_request(text, boolean) to authenticated;
    grant execute on function public.remove_friend(text) to authenticated;
    grant execute on function public.increment_gladiator_wins(text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.increment_cred_balance(text, integer) to service_role;
    grant execute on function public.exchange_cred_for_tokens(text, integer, integer) to service_role;
  end if;
end;
$$;

-- The CRED functions move money; keep them off the end-user roles.
revoke all on function public.increment_cred_balance(text, integer) from public;
revoke all on function public.exchange_cred_for_tokens(text, integer, integer) from public;

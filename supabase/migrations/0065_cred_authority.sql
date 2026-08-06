-- Make CRED movement server-authoritative.
--
-- Every CRED path in the app ran from the browser through
-- public.increment_counter(p_table, p_id, p_field, p_amount) — a SECURITY
-- DEFINER function that takes the table, the column and the delta as
-- parameters. Anyone holding the publishable key could therefore call
--
--   rpc('increment_counter', {p_table:'users', p_id:<any id>,
--                             p_field:'cred_balance', p_amount:1000000})
--
-- and mint CRED for any account, with RLS bypassed by the definer rights. The
-- same call inflates followers_count, reputation_score or compute_tokens.
--
-- 0063 and 0064 tried to keep the money functions off end users with
-- `revoke all ... from public`, which is not enough on Supabase: its bootstrap
-- runs ALTER DEFAULT PRIVILEGES granting EXECUTE on new functions to anon and
-- authenticated, and an explicit grant survives a revoke from PUBLIC. So
-- increment_cred_balance, exchange_cred_for_tokens and grant_cred_purchase were
-- all still callable by any signed-in user — grant_cred_purchase in particular
-- credits CRED for any payment id the caller invents.
--
-- Three changes close it:
--   1. the money functions are revoked from anon and authenticated by name;
--   2. clients get bump_public_counter, which only moves display counters;
--   3. spending goes through spend_cred / boost_post / tip_post /
--      redeem_referral, which prove ownership, refuse to overdraw, and write
--      the ledger in the same transaction as the balance.
-- A before-update trigger pins the balance columns so the leftover
-- `users self-update` RLS policy cannot be used to write them directly either.

-- -------------------------------------------------------------------------
-- 1. Take the money functions away from the end-user roles.
-- -------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.increment_counter(text, text, text, integer)',
    'public.increment_cred_balance(text, integer)',
    'public.exchange_cred_for_tokens(text, integer, integer)',
    'public.grant_cred_purchase(text, integer, text, text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    foreach v_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('revoke all on function %s from %I', v_fn, v_role);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
end;
$$;

-- -------------------------------------------------------------------------
-- 2. The counters a client may still move.
--
-- View counts, follower counts and crowd sizes are cosmetic, so they stay
-- client-driven; the allowlist is what stops the same entry point from being
-- pointed at a balance. increment_counter raises for an unknown table or
-- column, so a stale entry here fails loudly rather than silently.
-- -------------------------------------------------------------------------
-- Kept as a function so the migration test can assert every entry still exists
-- in the schema, which is how a renamed counter column gets caught.
create or replace function public.public_counter_columns()
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $$
  select array[
    'users.view_count',
    'users.followers_count',
    'users.following_count',
    'posts.view_count',
    'posts.likes',
    'posts.likes_count',
    'posts.comments_count',
    'posts.shares_count',
    'videos.view_count',
    'streams.viewer_count',
    'streams.crowd_size',
    'bot_listings.purchase_count'
  ];
$$;

create or replace function public.bump_public_counter(
  p_table text,
  p_id text,
  p_field text,
  p_amount integer default 1
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_id is null or p_table is null or p_field is null then
    raise exception 'bump_public_counter: p_table, p_id and p_field are required';
  end if;

  -- Counters move by ones and twos. A large delta is either a bug or an
  -- attempt to use this as a balance write.
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10 then
    raise exception 'bump_public_counter: p_amount must be a non-zero delta of at most 10, got %', p_amount;
  end if;

  if not (p_table || '.' || p_field) = any (public.public_counter_columns()) then
    raise exception 'bump_public_counter: %.% is not a client-writable counter', p_table, p_field;
  end if;

  perform public.increment_counter(p_table, p_id, p_field, p_amount);
end;
$$;

-- -------------------------------------------------------------------------
-- 3. Spending.
-- -------------------------------------------------------------------------

/**
 * Debits the signed-in account and optionally credits another, atomically.
 *
 * The browser used to do this with two independent increment_counter calls and
 * a client-side `balance >= cost` check, so two concurrent spends both passed
 * the check, and a failed debit still credited the recipient. Neither call
 * reported failure either: supabase-js resolves with `{ error }` rather than
 * throwing, and the call sites collected them in Promise.all without looking.
 */
create or replace function public.spend_cred(
  p_amount integer,
  p_description text,
  p_recipient_id text default null,
  p_recipient_amount integer default null,
  p_recipient_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.users;
  v_credit integer;
  v_balance integer;
begin
  select * into v_actor from public.users where auth_uid = (select auth.uid()) limit 1;
  if v_actor.id is null then
    raise exception 'spend_cred: no profile for the current session';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'spend_cred: p_amount must be between 1 and 1000000, got %', p_amount;
  end if;

  v_credit := case
    when p_recipient_id is null then 0
    else coalesce(p_recipient_amount, p_amount)
  end;
  if v_credit < 0 or v_credit > p_amount then
    raise exception 'spend_cred: p_recipient_amount must be between 0 and p_amount';
  end if;
  if p_recipient_id is not null then
    if p_recipient_id = v_actor.id then
      raise exception 'spend_cred: cannot pay yourself';
    end if;
    if not exists (select 1 from public.users where id = p_recipient_id) then
      raise exception 'spend_cred: recipient % does not exist', p_recipient_id;
    end if;
  end if;

  -- Admins have always been exempt from CRED costs in the UI; clamping at zero
  -- keeps that without letting a balance go negative.
  if coalesce(v_actor.role, 'user') = 'admin' then
    update public.users u
       set cred_balance = greatest(coalesce(u.cred_balance, 0) - p_amount, 0),
           updated_at = now()
     where u.id = v_actor.id
    returning u.cred_balance into v_balance;
  else
    update public.users u
       set cred_balance = coalesce(u.cred_balance, 0) - p_amount,
           updated_at = now()
     where u.id = v_actor.id
       and coalesce(u.cred_balance, 0) >= p_amount
    returning u.cred_balance into v_balance;

    if v_balance is null then
      raise exception 'insufficient_cred: % CRED required', p_amount
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.transactions (user_id, amount, type, description)
  values (v_actor.id, p_amount, 'spend', coalesce(p_description, 'CRED spend'));

  if v_credit > 0 then
    update public.users u
       set cred_balance = coalesce(u.cred_balance, 0) + v_credit,
           updated_at = now()
     where u.id = p_recipient_id;

    insert into public.transactions (user_id, amount, type, description)
    values (
      p_recipient_id,
      v_credit,
      'earn',
      coalesce(p_recipient_description, format('Received %s CRED from @%s', v_credit, v_actor.username))
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'spent', p_amount,
    'credited', v_credit,
    'cred_balance', v_balance
  );
end;
$$;

/**
 * Boosts a post.
 *
 * The client set `posts.is_boosted` directly, which `posts_update_owner` only
 * permits on your own posts — so boosting anyone else's post charged 50 CRED
 * and changed nothing, and the rejection was never surfaced.
 */
create or replace function public.boost_post(p_post_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cost constant integer := 50;
  v_post record;
  v_result jsonb;
begin
  select id, author_id, is_boosted into v_post
    from public.posts
   where id::text = p_post_id
     for update;

  if v_post.id is null then
    raise exception 'boost_post: post % not found', p_post_id;
  end if;
  if v_post.is_boosted then
    return jsonb_build_object('ok', false, 'reason', 'already_boosted');
  end if;

  v_result := public.spend_cred(v_cost, 'Boosted a transmission');

  update public.posts
     set is_boosted = true,
         boosts = coalesce(boosts, 0) + 1
   where id::text = p_post_id;

  return v_result || jsonb_build_object('ok', true, 'cost', v_cost);
end;
$$;

/** Tips a post's author: debit, credit, both ledger rows and the notification. */
create or replace function public.tip_post(
  p_post_id text,
  p_amount integer,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.users;
  v_author_id text;
  v_result jsonb;
begin
  select * into v_actor from public.users where auth_uid = (select auth.uid()) limit 1;
  if v_actor.id is null then
    raise exception 'tip_post: no profile for the current session';
  end if;

  select author_id into v_author_id from public.posts where id::text = p_post_id;
  if v_author_id is null then
    raise exception 'tip_post: post % not found', p_post_id;
  end if;

  v_result := public.spend_cred(
    p_amount,
    'Tipped post author for a transmission',
    v_author_id,
    p_amount,
    format('Tip from @%s', v_actor.username)
  );

  insert into public.notifications (user_id, type, payload, is_read)
  values (
    v_author_id,
    'tip',
    jsonb_build_object(
      'amount', p_amount,
      'senderName', v_actor.display_name,
      'senderUsername', v_actor.username,
      'message', left(coalesce(p_message, ''), 500),
      'postId', p_post_id
    ),
    false
  );

  return v_result;
end;
$$;

/**
 * Redeems a referral code for the signed-in account.
 *
 * The browser did this as five separate calls — look up the referrer, check for
 * an existing row, insert the referral, award both balances, notify — so an
 * interrupted run could award CRED without recording the referral, or record it
 * without awarding, and the awards themselves went through increment_counter.
 * `referrals.referred_id` is unique, so claiming the row first makes the whole
 * thing idempotent.
 */
create or replace function public.redeem_referral(p_referrer_username text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_referrer_award constant integer := 100;
  v_referred_award constant integer := 50;
  v_actor public.users;
  v_referrer public.users;
begin
  select * into v_actor from public.users where auth_uid = (select auth.uid()) limit 1;
  if v_actor.id is null then
    raise exception 'redeem_referral: no profile for the current session';
  end if;

  select * into v_referrer
    from public.users
   where lower(username) = lower(trim(coalesce(p_referrer_username, '')))
   limit 1;

  if v_referrer.id is null or v_referrer.id = v_actor.id then
    return jsonb_build_object('ok', false, 'reason', 'unknown_referrer');
  end if;

  insert into public.referrals (referrer_id, referred_id, referrer_username)
  values (v_referrer.id, v_actor.id, v_referrer.username)
  on conflict (referred_id) do nothing;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;

  update public.users
     set cred_balance = coalesce(cred_balance, 0) + v_referrer_award,
         referral_count = coalesce(referral_count, 0) + 1,
         updated_at = now()
   where id = v_referrer.id;

  update public.users
     set cred_balance = coalesce(cred_balance, 0) + v_referred_award,
         updated_at = now()
   where id = v_actor.id;

  insert into public.transactions (user_id, amount, type, description)
  values
    (v_referrer.id, v_referrer_award, 'earn', format('Referral bonus: @%s joined via your invite', v_actor.username)),
    (v_actor.id, v_referred_award, 'earn', format('Welcome bonus: joined via @%s''s invite', v_referrer.username));

  insert into public.notifications (user_id, type, payload, is_read)
  values (
    v_referrer.id,
    'referral_success',
    jsonb_build_object('referred_id', v_actor.id, 'referred_username', v_actor.username, 'cred_awarded', v_referrer_award),
    false
  );

  return jsonb_build_object(
    'ok', true,
    'referrer_award', v_referrer_award,
    'referred_award', v_referred_award
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 4. Pin the balance columns against direct writes.
--
-- `users self-update` (0001) permits updating every column of your own row, so
-- a client could PATCH cred_balance, compute_tokens or subscription_tier
-- straight to whatever it liked — and `setLocalTier` in the client did exactly
-- that for the tier. 0060 established this shape for `role`.
--
-- Deliberately not SECURITY DEFINER: `current_user` then still reports the role
-- that ran the statement, which is how a definer function's own writes
-- (spend_cred, grant_cred_purchase, the Stripe webhook via service_role) are
-- distinguished from a PostgREST write by anon/authenticated.
-- -------------------------------------------------------------------------
create or replace function public.enforce_balance_write_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  new.cred_balance := old.cred_balance;
  new.compute_tokens := old.compute_tokens;
  new.subscription_tier := old.subscription_tier;
  return new;
end;
$$;

drop trigger if exists users_enforce_balance_write_authority on public.users;
create trigger users_enforce_balance_write_authority
  before update of cred_balance, compute_tokens, subscription_tier on public.users
  for each row
  execute function public.enforce_balance_write_authority();

-- -------------------------------------------------------------------------
-- 5. Grants.
-- -------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.bump_public_counter(text, text, text, integer) to authenticated;
    grant execute on function public.spend_cred(integer, text, text, integer, text) to authenticated;
    grant execute on function public.boost_post(text) to authenticated;
    grant execute on function public.tip_post(text, integer, text) to authenticated;
    grant execute on function public.redeem_referral(text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- Anonymous visitors still register a profile/post view.
    grant execute on function public.bump_public_counter(text, text, text, integer) to anon;
    revoke all on function public.spend_cred(integer, text, text, integer, text) from anon;
    revoke all on function public.boost_post(text) from anon;
    revoke all on function public.tip_post(text, integer, text) from anon;
    revoke all on function public.redeem_referral(text) from anon;
  end if;
end;
$$;

-- Move the CRED economy and paid-tier entitlements out of reach of the browser.
--
-- Everything below was reachable from an ordinary signed-in session holding the
-- public anon key. Reproduced against a fresh database:
--
--   select increment_counter('users','<self>','cred_balance', 1000000);  -- mint
--   select increment_counter('users','<victim>','cred_balance',-1000000);-- drain
--   update users set subscription_tier='architect' where auth_uid=auth.uid();
--   insert into subscriptions (user_id,tier,status) values (self,'architect','active');
--   insert into transactions (user_id,amount,type) values (self,999999,'earn');
--
-- 0065 narrowed increment_counter to an allowlist of (table, column) pairs but
-- left `users.cred_balance` on it with no row-ownership check, so any caller
-- could move any account's balance by up to a million per call. Its own header
-- says as much: "balances and tips need to move server-side before they can be
-- considered safe." This migration is that move.
--
-- The same client-side flows were also broken for an unrelated reason: tipping
-- and buying a bot both insert a notification for the *recipient*, which the
-- owner-scoped policy on `notifications` rejects. The CRED moved and the UI
-- then told the payer the transfer had failed. Routing both through a function
-- that runs as the owner fixes the correctness bug and the security hole in one
-- step, and makes debit, credit and ledger rows atomic instead of a
-- `Promise.all` of independent statements that can half-succeed.

-- ---------------------------------------------------------------------------
-- 1. Freeze the economy and entitlement columns against end-user writes
-- ---------------------------------------------------------------------------
-- RLS cannot express column-level restrictions, so this mirrors the approach
-- 0060 already uses to pin `role`. The economy functions further down opt out
-- for the duration of their own transaction via `bsc.trusted_write`.

create or replace function public.enforce_users_protected_columns()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  _actor uuid := auth.uid();
  _actor_role text;
begin
  -- No end-user JWT: service role, migrations, psql. Already trusted.
  if _actor is null then
    return new;
  end if;

  -- Set only by the SECURITY DEFINER economy functions below, and only for
  -- their own transaction, so a client cannot arrive with it already on.
  if coalesce(current_setting('bsc.trusted_write', true), '') = 'on' then
    return new;
  end if;

  select u.role into _actor_role from public.users u where u.auth_uid = _actor;
  if coalesce(_actor_role, 'user') = 'admin' then
    return new;
  end if;

  new.cred_balance := old.cred_balance;
  new.compute_tokens := old.compute_tokens;
  new.subscription_tier := old.subscription_tier;
  new.reputation_score := old.reputation_score;
  return new;
end;
$$;

drop trigger if exists users_protect_economy_columns on public.users;
create trigger users_protect_economy_columns
  before update of cred_balance, compute_tokens, subscription_tier, reputation_score
  on public.users
  for each row
  execute function public.enforce_users_protected_columns();

-- ---------------------------------------------------------------------------
-- 2. Take the balance counters off the client-reachable allowlist
-- ---------------------------------------------------------------------------
-- The remaining pairs are social/engagement counters. `users.cred_balance` and
-- `feature_usage.usage_count` decide money and quota, so they are service-role
-- only; the trigger above would silently no-op an end-user call, and a silent
-- no-op on a payment path is worse than a refusal.

create or replace function public.increment_counter(
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
declare
  v_id_type text;
  v_allowed boolean;
  v_privileged boolean;
begin
  select (p_table, p_field) in (
    ('bot_listings', 'purchase_count'),
    ('feature_usage', 'usage_count'),
    ('posts', 'boosts'),
    ('posts', 'comments_count'),
    ('posts', 'likes_count'),
    ('posts', 'shares_count'),
    ('posts', 'view_count'),
    ('streams', 'crowd_size'),
    ('streams', 'viewer_count'),
    ('users', 'cred_balance'),
    ('users', 'followers_count'),
    ('users', 'following_count'),
    ('users', 'view_count'),
    ('videos', 'view_count')
  ) into v_allowed;

  if not v_allowed then
    raise exception 'increment_counter: public.%.% is not an incrementable counter', p_table, p_field
      using errcode = '42501';
  end if;

  select (p_table, p_field) in (
    ('users', 'cred_balance'),
    ('feature_usage', 'usage_count')
  ) into v_privileged;

  if v_privileged and auth.uid() is not null then
    raise exception 'increment_counter: public.%.% moves only through a server-authoritative function', p_table, p_field
      using errcode = '42501';
  end if;

  -- Every real caller moves a counter by a handful at a time; the cap keeps a
  -- single call from rewriting a balance wholesale.
  if p_amount is null or abs(p_amount) > 1000000 then
    raise exception 'increment_counter: p_amount % is out of range', p_amount
      using errcode = '22003';
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into v_id_type
  from pg_attribute a
  where a.attrelid = format('public.%I', p_table)::regclass
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_id_type is null then
    raise exception 'increment_counter: public.% has no id column', p_table;
  end if;

  -- Balance moves arrive here only from the service role, which the trigger in
  -- section 1 already trusts; the flag keeps that true if it ever tightens.
  if v_privileged then
    perform set_config('bsc.trusted_write', 'on', true);
  end if;

  execute format(
    'update public.%I set %I = coalesce(%I, 0) + $1 where id = $2::%s',
    p_table, p_field, p_field, v_id_type
  ) using p_amount, p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. spend_cred — the one way a client may move CRED
-- ---------------------------------------------------------------------------
-- The payer is always the calling session: a client chooses how much to spend
-- and who receives it, never who pays. The credit is capped at the debit, so
-- CRED can move between accounts or be burned, but never created.

create or replace function public.spend_cred(
  p_amount integer,
  p_reason text,
  p_recipient_id text default null,
  p_recipient_amount integer default null,
  p_recipient_notification jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  _actor_id text;
  _actor_role text;
  _balance integer;
  _credit integer;
  _new_balance integer;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'spend_cred: p_amount must be between 1 and 1000000'
      using errcode = '22003';
  end if;

  select u.id, u.role into _actor_id, _actor_role
  from public.users u
  where u.auth_uid = auth.uid();

  if _actor_id is null then
    raise exception 'spend_cred: the calling session has no profile'
      using errcode = '42501';
  end if;

  if p_recipient_id is not null and p_recipient_id = _actor_id then
    raise exception 'spend_cred: cannot pay yourself'
      using errcode = '22023';
  end if;

  _credit := least(coalesce(p_recipient_amount, p_amount), p_amount);
  if _credit < 0 then
    raise exception 'spend_cred: p_recipient_amount cannot be negative'
      using errcode = '22003';
  end if;

  perform set_config('bsc.trusted_write', 'on', true);

  -- Two concurrent spends by the same account must not both clear the balance
  -- check, so read the balance under a row lock.
  select u.cred_balance into _balance
  from public.users u
  where u.id = _actor_id
  for update;

  -- Admins spend without a balance requirement, matching the existing UI.
  if coalesce(_actor_role, 'user') <> 'admin' and coalesce(_balance, 0) < p_amount then
    raise exception 'spend_cred: insufficient CRED (% available, % required)',
      coalesce(_balance, 0), p_amount
      using errcode = '23514';
  end if;

  update public.users
     set cred_balance = coalesce(cred_balance, 0) - p_amount,
         updated_at = now()
   where id = _actor_id
  returning cred_balance into _new_balance;

  insert into public.transactions (user_id, amount, type, description)
  values (_actor_id, p_amount, 'spend', coalesce(p_reason, 'CRED spend'));

  if p_recipient_id is not null and _credit > 0 then
    update public.users
       set cred_balance = coalesce(cred_balance, 0) + _credit,
           updated_at = now()
     where id = p_recipient_id;

    if not found then
      raise exception 'spend_cred: recipient % does not exist', p_recipient_id
        using errcode = '23503';
    end if;

    insert into public.transactions (user_id, amount, type, description)
    values (p_recipient_id, _credit, 'earn', coalesce(p_reason, 'CRED received'));

    -- The owner-scoped policy on notifications rejects this insert when the
    -- payer attempts it directly, which is why tipping reported failure after
    -- the money had already moved.
    if p_recipient_notification is not null then
      insert into public.notifications (user_id, type, payload)
      values (
        p_recipient_id,
        coalesce(p_recipient_notification->>'type', 'cred'),
        coalesce(p_recipient_notification->'payload', '{}'::jsonb)
      );
    end if;
  end if;

  return jsonb_build_object(
    'spent', p_amount,
    'credited', case when p_recipient_id is null then 0 else _credit end,
    'cred_balance', _new_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. purchase_bot_listing — atomic marketplace purchase
-- ---------------------------------------------------------------------------
-- `bot_purchases` had an owner-scoped INSERT policy and nothing tying the row
-- to a payment, so `insert into bot_purchases (buyer_id, bot_id, price_paid)
-- values (self, any_bot, 0)` handed over any listing for free — BotMarketplace
-- reads ownership straight out of that table.

create or replace function public.purchase_bot_listing(p_bot_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  _buyer_id text;
  _buyer_role text;
  _buyer_name text;
  _balance integer;
  _price integer;
  _creator_id text;
  _bot_name text;
  _payout integer;
  _new_balance integer;
begin
  select u.id, u.role, coalesce(u.display_name, u.username)
    into _buyer_id, _buyer_role, _buyer_name
  from public.users u
  where u.auth_uid = auth.uid();

  if _buyer_id is null then
    raise exception 'purchase_bot_listing: the calling session has no profile'
      using errcode = '42501';
  end if;

  select b.price, b.creator_id, b.name
    into _price, _creator_id, _bot_name
  from public.bot_listings b
  where b.id = p_bot_id
  for update;

  if _price is null then
    raise exception 'purchase_bot_listing: listing % does not exist', p_bot_id
      using errcode = '23503';
  end if;

  if _creator_id = _buyer_id then
    raise exception 'purchase_bot_listing: you already own this listing'
      using errcode = '22023';
  end if;

  perform set_config('bsc.trusted_write', 'on', true);

  -- The unique (buyer_id, bot_id) index makes this the idempotency check: a
  -- replayed request finds the row already claimed and charges nothing.
  insert into public.bot_purchases (buyer_id, bot_id, price_paid)
  values (_buyer_id, p_bot_id, _price)
  on conflict (buyer_id, bot_id) do nothing;

  if not found then
    return jsonb_build_object('purchased', false, 'reason', 'already_owned');
  end if;

  select u.cred_balance into _balance
  from public.users u
  where u.id = _buyer_id
  for update;

  if coalesce(_buyer_role, 'user') <> 'admin' and coalesce(_balance, 0) < _price then
    raise exception 'purchase_bot_listing: insufficient CRED (% available, % required)',
      coalesce(_balance, 0), _price
      using errcode = '23514';
  end if;

  _payout := floor(_price * 0.8)::integer;

  update public.users
     set cred_balance = coalesce(cred_balance, 0) - _price,
         updated_at = now()
   where id = _buyer_id
  returning cred_balance into _new_balance;

  update public.bot_listings
     set purchase_count = coalesce(purchase_count, 0) + 1
   where id = p_bot_id;

  if _price > 0 then
    insert into public.transactions (user_id, amount, type, description)
    values (_buyer_id, _price, 'spend', format('Purchased bot: %s', _bot_name));
  end if;

  if _payout > 0 then
    update public.users
       set cred_balance = coalesce(cred_balance, 0) + _payout,
           updated_at = now()
     where id = _creator_id;

    insert into public.transactions (user_id, amount, type, description)
    values (_creator_id, _payout, 'earn', format('Bot sale: %s', _bot_name));
  end if;

  insert into public.notifications (user_id, type, payload)
  values (_creator_id, 'bot_sale', jsonb_build_object(
    'bot_name', _bot_name,
    'buyer_id', _buyer_id,
    'buyer_name', _buyer_name,
    'cred_earned', _payout
  ));

  return jsonb_build_object(
    'purchased', true,
    'price', _price,
    'cred_balance', _new_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. claim_referral_bonus — grants CRED, so the grant lives server-side
-- ---------------------------------------------------------------------------
-- A referral mints new CRED, which no client may be trusted to do. The caller
-- may only claim a referral *for themselves*, and `referrals.referred_id` is
-- unique, so the insert is the idempotency guard.

create or replace function public.claim_referral_bonus(p_referrer_username text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  _referred_id text;
  _referrer_id text;
  _referrer_award integer := 100;
  _referred_award integer := 50;
begin
  select u.id into _referred_id
  from public.users u
  where u.auth_uid = auth.uid();

  if _referred_id is null then
    raise exception 'claim_referral_bonus: the calling session has no profile'
      using errcode = '42501';
  end if;

  select u.id into _referrer_id
  from public.users u
  where u.username = p_referrer_username;

  if _referrer_id is null or _referrer_id = _referred_id then
    return jsonb_build_object('claimed', false, 'reason', 'invalid_referrer');
  end if;

  perform set_config('bsc.trusted_write', 'on', true);

  insert into public.referrals (referrer_id, referred_id, referrer_username,
                                cred_awarded_referrer, cred_awarded_referred)
  values (_referrer_id, _referred_id, p_referrer_username,
          _referrer_award, _referred_award)
  on conflict (referred_id) do nothing;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  end if;

  update public.users
     set cred_balance = coalesce(cred_balance, 0) + _referrer_award,
         updated_at = now()
   where id = _referrer_id;

  update public.users
     set cred_balance = coalesce(cred_balance, 0) + _referred_award,
         updated_at = now()
   where id = _referred_id;

  insert into public.transactions (user_id, amount, type, description)
  values
    (_referrer_id, _referrer_award, 'earn',
     format('Referral bonus: %s joined via your invite', _referred_id)),
    (_referred_id, _referred_award, 'earn',
     format('Welcome bonus: joined via @%s''s invite', p_referrer_username));

  insert into public.notifications (user_id, type, payload)
  values (_referrer_id, 'referral_success', jsonb_build_object(
    'referred_id', _referred_id,
    'cred_awarded', _referrer_award
  ));

  return jsonb_build_object('claimed', true, 'cred_awarded', _referred_award);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. record_feature_usage — quota meters the client cannot rewind
-- ---------------------------------------------------------------------------
-- The owner UPDATE policy let a user set `usage_count` back to 0 and reset
-- every metered feature. The read-modify-write in the client also lost
-- increments when two actions overlapped; a single upsert cannot.

create or replace function public.record_feature_usage(
  p_feature text,
  p_amount integer default 1,
  p_period_start timestamptz default date_trunc('month', now()),
  p_period_end timestamptz default (date_trunc('month', now()) + interval '1 month')
)
returns public.feature_usage
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  _user_id text;
  _row public.feature_usage;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then
    raise exception 'record_feature_usage: p_amount must be between 1 and 10000'
      using errcode = '22003';
  end if;

  select u.id into _user_id
  from public.users u
  where u.auth_uid = auth.uid();

  if _user_id is null then
    raise exception 'record_feature_usage: the calling session has no profile'
      using errcode = '42501';
  end if;

  insert into public.feature_usage (user_id, feature, usage_count, period_start, period_end)
  values (_user_id, p_feature, p_amount, p_period_start, p_period_end)
  on conflict (user_id, feature, period_start, period_end)
  do update set usage_count = public.feature_usage.usage_count + excluded.usage_count,
                updated_at = now()
  returning * into _row;

  return _row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Close the direct write paths the functions above replace
-- ---------------------------------------------------------------------------

-- Ledger rows are written by the economy functions. A client that can insert
-- its own `transactions` rows can fabricate an earnings history.
drop policy if exists "tx owner" on public.transactions;
drop policy if exists transactions_owner_select on public.transactions;
create policy transactions_owner_select on public.transactions
  for select to authenticated using (
    exists (
      select 1 from public.users u
      where u.id = transactions.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

-- Entitlement rows come from Stripe webhooks (service role) only. Inserting
-- {tier:'architect', status:'active'} here fired sync_user_subscription_tier()
-- and handed out the paid tier for free.
drop policy if exists subscriptions_owner_insert on public.subscriptions;
drop policy if exists subscriptions_owner_update on public.subscriptions;

-- Quota meters move through record_feature_usage().
drop policy if exists feature_usage_owner_insert on public.feature_usage;
drop policy if exists feature_usage_owner_update on public.feature_usage;

-- Ownership is granted by purchase_bot_listing() together with the payment.
drop policy if exists bot_purchases_insert_buyer on public.bot_purchases;

-- The stream chat INSERT policy checked only that the caller was signed in, so
-- sender_id/sender_name could name anyone. 0004/0005 tried to fix this by
-- altering a policy that does not exist on a fresh database, so they were
-- no-ops and the permissive policy survived every reset.
drop policy if exists "stream_chat authed write" on public.stream_chat;
drop policy if exists schat_insert_self on public.stream_chat;
create policy schat_insert_self on public.stream_chat
  for insert to authenticated with check (
    exists (
      select 1 from public.users u
      where u.id = stream_chat.sender_id
        and u.auth_uid = (select auth.uid())
    )
  );

-- `for all` granted DELETE on every void post to every signed-in user. The
-- scoped insert/update policies from 0002 stay; anonymous decay counters are
-- meant to be writable, wholesale deletion of other people's posts is not.
drop policy if exists "void authed write" on public.void_posts;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.spend_cred(integer, text, text, integer, jsonb) to authenticated;
    grant execute on function public.purchase_bot_listing(text) to authenticated;
    grant execute on function public.claim_referral_bonus(text) to authenticated;
    grant execute on function public.record_feature_usage(text, integer, timestamptz, timestamptz) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.spend_cred(integer, text, text, integer, jsonb) to service_role;
    grant execute on function public.purchase_bot_listing(text) to service_role;
    grant execute on function public.claim_referral_bonus(text) to service_role;
    grant execute on function public.record_feature_usage(text, integer, timestamptz, timestamptz) to service_role;
  end if;
end;
$$;

-- These move money; keep them off anon and PUBLIC.
revoke all on function public.spend_cred(integer, text, text, integer, jsonb) from public;
revoke all on function public.purchase_bot_listing(text) from public;
revoke all on function public.claim_referral_bonus(text) from public;
revoke all on function public.record_feature_usage(text, integer, timestamptz, timestamptz) from public;

-- Make a CRED purchase grant idempotent per Square payment.
--
-- /api/square/process-payment credited CRED whenever Square answered COMPLETED.
-- Square's CreatePayment is itself idempotent on the caller's key, so replaying
-- the same request returns the *same* completed payment — and the route granted
-- the CRED again. One card charge could therefore be redeemed repeatedly (the
-- payments rate limiter allows ten calls a minute), because nothing recorded
-- which payments had already been honoured.
--
-- The ledger row is now that record: external_id is unique, so the insert either
-- claims the payment or reports it as already granted, and the balance moves in
-- the same transaction as the row that claims it.

alter table public.transactions
  add column if not exists external_id text;

-- Not partial: NULLs are distinct in a unique index, so pre-existing rows and
-- non-purchase ledger entries are unaffected, and ON CONFLICT can still infer it.
create unique index if not exists transactions_external_id_key
  on public.transactions (external_id);

create or replace function public.grant_cred_purchase(
  p_user_id text,
  p_amount integer,
  p_payment_id text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_balance integer;
begin
  if p_user_id is null or p_payment_id is null then
    raise exception 'grant_cred_purchase: p_user_id and p_payment_id are required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'grant_cred_purchase: p_amount must be positive';
  end if;

  insert into public.transactions (user_id, amount, type, description, external_id)
  values (
    p_user_id,
    p_amount,
    'purchase',
    coalesce(p_description, format('Purchased %s CRED', p_amount)),
    p_payment_id
  )
  on conflict (external_id) do nothing;

  if not found then
    return jsonb_build_object('granted', false, 'reason', 'already_granted');
  end if;

  update public.users u
     set cred_balance = coalesce(u.cred_balance, 0) + p_amount,
         updated_at = now()
   where u.id = p_user_id
  returning u.cred_balance into v_balance;

  -- Raising rolls the ledger row back with it, so a bad user id cannot leave a
  -- claimed payment that was never credited.
  if v_balance is null then
    raise exception 'grant_cred_purchase: user % not found', p_user_id;
  end if;

  return jsonb_build_object('granted', true, 'cred_balance', v_balance);
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.grant_cred_purchase(text, integer, text, text) to service_role;
  end if;
end;
$$;

-- Moves money; keep it off the end-user roles.
revoke all on function public.grant_cred_purchase(text, integer, text, text) from public;

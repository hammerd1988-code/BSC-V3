-- Subscription entitlements are server-owned.
--
-- 00231 granted `authenticated` INSERT and UPDATE on public.subscriptions for
-- rows the caller owns, and 0040's sync_user_subscription_tier() trigger copies
-- the winning tier onto users.subscription_tier. Together those let any
-- signed-in account insert itself an `active` / `architect` row and hold every
-- paid entitlement. `users self-update` reaches users.subscription_tier
-- directly as well, so the column needed pinning on both paths.
--
-- Stripe is the only legitimate writer, and it writes through the service role
-- in stripeRoutes.ts, which bypasses both RLS and these grants. The sole client
-- writer was subscription.tsx's setLocalTier, which had no call sites and is
-- removed alongside this migration.
--
-- Local Coder licensing made this load-bearing on a second surface:
-- GET /api/license/verify resolves users.subscription_tier into the feature set
-- an external install unlocks (hosted AI, remote node count).

drop policy if exists subscriptions_owner_insert on public.subscriptions;
drop policy if exists subscriptions_owner_update on public.subscriptions;

revoke insert, update on public.subscriptions from anon, authenticated;

-- The tier public.subscriptions currently entitles a user to. Shared by the
-- guard below so it can recognise sync_user_subscription_tier()'s own writes
-- instead of fighting them; kept in step with 0040's ordering deliberately.
create or replace function public.active_subscription_tier(_user_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.tier
      from public.subscriptions s
      where s.user_id = _user_id
        and s.status = 'active'
        and (s.expires_at is null or s.expires_at > now())
      order by
        case s.tier when 'architect' then 3 when 'operator' then 2 else 1 end desc,
        s.started_at desc
      limit 1
    ),
    'indie'
  );
$$;

revoke execute on function public.active_subscription_tier(text) from public, anon, authenticated;

create or replace function public.enforce_subscription_tier_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
begin
  -- Nested rather than combined with `and`: plpgsql evaluates an IF condition
  -- as one SQL expression, and OLD is unassigned during an INSERT.
  if tg_op = 'UPDATE' then
    if new.subscription_tier is not distinct from old.subscription_tier then
      return new;
    end if;
  end if;

  -- No end-user JWT (service role / Stripe webhook / SQL editor), or an admin
  -- acting deliberately.
  if _actor is null or public.is_admin_user() then
    return new;
  end if;

  -- public.subscriptions is the entitlement of record and clients now hold no
  -- write privilege on it, so a value that agrees with it is
  -- sync_user_subscription_tier() doing its job rather than a self-grant.
  if new.subscription_tier is not distinct from public.active_subscription_tier(new.id) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.subscription_tier := old.subscription_tier;
  else
    new.subscription_tier := public.active_subscription_tier(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists users_enforce_subscription_tier_authority on public.users;
create trigger users_enforce_subscription_tier_authority
  before insert or update of subscription_tier on public.users
  for each row
  execute function public.enforce_subscription_tier_authority();

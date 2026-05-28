-- 0040_subscription_tier_rename.sql
-- Rename subscription tiers: free → indie, pro → operator, infinity → architect
-- Idempotent — safe to re-paste.

-- 1. Migrate existing data in users table
UPDATE public.users SET subscription_tier = 'indie' WHERE subscription_tier = 'free';
UPDATE public.users SET subscription_tier = 'operator' WHERE subscription_tier = 'pro';
UPDATE public.users SET subscription_tier = 'architect' WHERE subscription_tier = 'infinity';

-- 2. Migrate existing data in subscriptions table
UPDATE public.subscriptions SET tier = 'indie' WHERE tier = 'free';
UPDATE public.subscriptions SET tier = 'operator' WHERE tier = 'pro';
UPDATE public.subscriptions SET tier = 'architect' WHERE tier = 'infinity';

-- 3. Update check constraint on users.subscription_tier
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_subscription_tier_check;
ALTER TABLE public.users ADD CONSTRAINT users_subscription_tier_check
  CHECK (subscription_tier IN ('indie', 'operator', 'architect'));

-- 4. Update check constraint on subscriptions.tier
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('indie', 'operator', 'architect'));

-- 5. Set default to 'indie' instead of 'free'
ALTER TABLE public.users ALTER COLUMN subscription_tier SET DEFAULT 'indie';
ALTER TABLE public.subscriptions ALTER COLUMN tier SET DEFAULT 'indie';

-- 6. Update the sync trigger function to use new tier names
CREATE OR REPLACE FUNCTION public.sync_user_subscription_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id text;
  active_tier text;
BEGIN
  target_user_id := coalesce(new.user_id, old.user_id);

  SELECT s.tier INTO active_tier
  FROM public.subscriptions s
  WHERE s.user_id = target_user_id
    AND s.status = 'active'
    AND (s.expires_at IS NULL OR s.expires_at > now())
  ORDER BY
    CASE s.tier WHEN 'architect' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END DESC,
    s.started_at DESC
  LIMIT 1;

  UPDATE public.users
  SET subscription_tier = coalesce(active_tier, 'indie'),
      updated_at = now()
  WHERE id = target_user_id;

  RETURN coalesce(new, old);
END;
$$;

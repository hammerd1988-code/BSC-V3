-- The client has referenced users.onboarding_complete since the OnboardingWizard
-- shipped (App.tsx gate + wizard save + casperAutonomy), but the column never
-- existed in the schema. That meant:
--   1. The wizard never opened (undefined === false is never true), and
--   2. Any update that included onboarding_complete failed wholesale, taking
--      display_name/bio/custom_accent/ai_settings down with it.
alter table public.users
  add column if not exists onboarding_complete boolean not null default false;

-- Accounts older than the wizard's 24h "recently created" window predate
-- first-run onboarding; mark them complete so they are never shown it.
update public.users
   set onboarding_complete = true
 where created_at < now() - interval '1 day';

-- Make 0038's anon read policy on gladiators actually do something.
--
-- 0038 added `create policy gladiators_read_anon ... for select to anon
-- using (true)` to fix "No bots available" on the Bot Chat page, which happens
-- when the Supabase JS client issues its first gladiator query before the JWT
-- has hydrated, so the request arrives as anon. The policy alone cannot fix it:
-- Postgres checks the table/column grant before it ever evaluates RLS, and
-- 0014/0016 do `revoke select on public.gladiators from anon, authenticated`
-- (the api_key column must never reach a browser) and then re-grant only
-- specific columns, only to authenticated. anon therefore still gets
-- `permission denied for table gladiators` and the policy is dead weight.
--
-- Grant anon the same non-secret column list authenticated already has. Keeping
-- the two lists identical matters: a query that names a column granted to only
-- one of the roles fails outright, which is how a page ends up working when
-- signed in and empty when not. api_key stays omitted from both.

grant select (
  id,
  user_id,
  name,
  avatar_url,
  personality,
  stats,
  glow_color,
  wins,
  losses,
  cred,
  created_at,
  model,
  api_base_url
) on public.gladiators to anon;

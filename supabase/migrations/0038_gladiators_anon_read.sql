-- Allow anonymous users to read gladiators.
-- Gladiator data is public (visible in Colosseum, leaderboards, etc.) and the
-- authenticated-only policy caused "permission denied" when the Supabase JS
-- client's JWT wasn't hydrated yet, resulting in "No bots available" on the
-- Bot Chat page.
--
-- Postgres has no `create policy if not exists`, so this migration used to abort
-- with a syntax error and the policy was never created.
drop policy if exists gladiators_read_anon on public.gladiators;
create policy gladiators_read_anon on public.gladiators
  for select
  to anon
  using (true);

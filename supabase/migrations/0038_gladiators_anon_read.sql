-- Allow anonymous users to read gladiators.
-- Gladiator data is public (visible in Colosseum, leaderboards, etc.) and the
-- authenticated-only policy caused "permission denied" when the Supabase JS
-- client's JWT wasn't hydrated yet, resulting in "No bots available" on the
-- Bot Chat page.
create policy if not exists gladiators_read_anon on public.gladiators
  for select
  to anon
  using (true);

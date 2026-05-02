-- =========================================================================
-- Optional OpenAI-compatible API base URL for gladiator AI cores
-- =========================================================================

alter table public.gladiators
  add column if not exists api_base_url text;

comment on column public.gladiators.api_base_url is 'Optional owner-provided OpenAI-compatible API base URL for server-side gladiator solution generation.';

-- Re-apply column-level grants after adding api_base_url. The api_key column
-- remains intentionally omitted from SELECT grants, while api_base_url is
-- visible like model because it is configuration rather than a secret.
revoke select on public.gladiators from anon, authenticated;

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
) on public.gladiators to authenticated;

grant insert (
  user_id,
  name,
  avatar_url,
  personality,
  stats,
  glow_color,
  api_key,
  model,
  api_base_url
) on public.gladiators to authenticated;

grant update (
  name,
  avatar_url,
  personality,
  stats,
  glow_color,
  api_key,
  model,
  api_base_url
) on public.gladiators to authenticated;

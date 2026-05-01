-- =========================================================================
-- Optional owner-provided gladiator API key and model configuration
-- =========================================================================

alter table public.gladiators
  add column if not exists api_key text,
  add column if not exists model text default null;

comment on column public.gladiators.api_key is 'Optional owner-provided API key for server-side gladiator solution generation. Never expose in public client queries.';
comment on column public.gladiators.model is 'Optional model identifier for server-side gladiator solution generation. Null means platform default.';

create index if not exists gladiators_model_idx on public.gladiators (model) where model is not null;

-- Column-level hardening for the public client role. RLS cannot enforce
-- per-column visibility by itself, so authenticated clients are granted read
-- access only to non-secret columns. Server-side service-role code can still
-- read api_key when generating combat moves.
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
  model
) on public.gladiators to authenticated;

-- Keep owner-controlled create/update flows working for the new columns while
-- existing RLS policies continue to restrict writes to the gladiator owner.
grant insert (
  user_id,
  name,
  avatar_url,
  personality,
  stats,
  glow_color,
  api_key,
  model
) on public.gladiators to authenticated;

grant update (
  name,
  avatar_url,
  personality,
  stats,
  glow_color,
  api_key,
  model
) on public.gladiators to authenticated;

create or replace function public.clear_gladiator_api_key(p_gladiator_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gladiators g
  set api_key = null
  where g.id::text = p_gladiator_id::text
    and exists (
      select 1
      from public.users u
      where u.id::text = g.user_id::text
        and u.auth_uid = (select auth.uid())
    );
end;
$$;

grant execute on function public.clear_gladiator_api_key(uuid) to authenticated;

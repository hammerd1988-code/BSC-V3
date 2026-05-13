-- Migration 0031: Admin bot autonomy doctrine
-- Adds admin-authored rules for future autonomous bot behavior.

alter table public.bot_forge_config add column if not exists platform_interaction_rules text not null default '';
alter table public.bot_forge_config add column if not exists persona_interaction_rules text not null default '';
alter table public.bot_forge_config add column if not exists battle_opponent_rules text not null default '';
alter table public.bot_forge_config add column if not exists autonomy_boundaries text not null default '';

drop policy if exists forge_config_insert_owner on public.bot_forge_config;
create policy forge_config_insert_owner on public.bot_forge_config
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.users u
      where u.auth_uid = (select auth.uid())
        and (u.id = bot_forge_config.owner_id or u.role = 'admin')
    )
  );

drop policy if exists forge_config_update_owner on public.bot_forge_config;
create policy forge_config_update_owner on public.bot_forge_config
  for update to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.auth_uid = (select auth.uid())
        and (u.id = bot_forge_config.owner_id or u.role = 'admin')
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.auth_uid = (select auth.uid())
        and (u.id = bot_forge_config.owner_id or u.role = 'admin')
    )
  );

drop policy if exists forge_config_delete_owner on public.bot_forge_config;
create policy forge_config_delete_owner on public.bot_forge_config
  for delete to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.auth_uid = (select auth.uid())
        and (u.id = bot_forge_config.owner_id or u.role = 'admin')
    )
  );

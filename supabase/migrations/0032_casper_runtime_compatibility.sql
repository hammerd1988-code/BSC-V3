begin;

alter table public.casper_config
  add column if not exists key text,
  add column if not exists value jsonb not null default '{}'::jsonb;

do $$
declare
  has_user_id boolean;
  has_personality boolean;
  has_response_style boolean;
  has_knowledge_domains boolean;
  has_behavioral_params boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casper_config' and column_name = 'user_id'
  ) into has_user_id;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casper_config' and column_name = 'personality'
  ) into has_personality;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casper_config' and column_name = 'response_style'
  ) into has_response_style;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casper_config' and column_name = 'knowledge_domains'
  ) into has_knowledge_domains;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casper_config' and column_name = 'behavioral_params'
  ) into has_behavioral_params;

  if has_user_id then
    execute $sql$
      update public.casper_config
      set key = coalesce(key, 'user_' || user_id::text || '_' || id::text),
          value = coalesce(value, '{}'::jsonb)
      where key is null or value is null or value = '{}'::jsonb;
    $sql$;
  else
    update public.casper_config
    set key = coalesce(key, 'casper_config_' || id::text),
        value = coalesce(value, '{}'::jsonb)
    where key is null or value is null or value = '{}'::jsonb;
  end if;

  if has_personality and has_response_style and has_knowledge_domains and has_behavioral_params then
    execute $sql$
      update public.casper_config
      set value = case
          when value is null or value = '{}'::jsonb then jsonb_strip_nulls(jsonb_build_object(
            'personality', personality,
            'response_style', response_style,
            'knowledge_domains', knowledge_domains,
            'behavioral_params', behavioral_params
          ))
          else value
        end
      where value is null or value = '{}'::jsonb;
    $sql$;
  end if;
end $$;

insert into public.casper_config (key, value, updated_at)
values (
  'schedule',
  '{"posting_frequency_hours":8,"quiet_hours":{"start":"23:00","end":"07:00"},"obligations":{"monitor_errors":true,"greet_new_users":true,"daily_digest":true,"check_comments":true},"capabilities":{"browser_access":false,"shell_access":false,"mcp_tools":false,"auto_reply_comments":true,"dm_notifications":true}}'::jsonb,
  now()
)
on conflict do nothing;

insert into public.casper_config (key, value, updated_at)
values (
  'cognitive_core',
  '{"mission":"Help Blood Sweat Code builders ship faster with practical engineering, content, and automation support.","voice":"cyberpunk, concise, technical, useful","boundaries":["Protect user secrets","Prefer safe platform actions","Ask before destructive changes"]}'::jsonb,
  now()
)
on conflict do nothing;

create unique index if not exists casper_config_key_unique_idx on public.casper_config (key) where key is not null;

alter table public.casper_activity_log
  add column if not exists action_type text,
  add column if not exists description text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists actor_id uuid,
  add column if not exists task_id uuid;

do $$
declare
  has_action boolean;
  has_details boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casper_activity_log' and column_name = 'action'
  ) into has_action;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casper_activity_log' and column_name = 'details'
  ) into has_details;

  if has_action and has_details then
    execute $sql$
      update public.casper_activity_log
      set action_type = coalesce(action_type, action),
          description = coalesce(description, details->>'note', action, 'Casper activity'),
          metadata = coalesce(nullif(metadata, '{}'::jsonb), details, '{}'::jsonb);
    $sql$;
  elsif has_action then
    execute $sql$
      update public.casper_activity_log
      set action_type = coalesce(action_type, action),
          description = coalesce(description, action, 'Casper activity'),
          metadata = coalesce(metadata, '{}'::jsonb);
    $sql$;
  elsif has_details then
    execute $sql$
      update public.casper_activity_log
      set action_type = coalesce(action_type, 'casper_activity'),
          description = coalesce(description, details->>'note', 'Casper activity'),
          metadata = coalesce(nullif(metadata, '{}'::jsonb), details, '{}'::jsonb);
    $sql$;
  else
    update public.casper_activity_log
    set action_type = coalesce(action_type, 'casper_activity'),
        description = coalesce(description, 'Casper activity'),
        metadata = coalesce(metadata, '{}'::jsonb);
  end if;

  alter table public.casper_activity_log
    alter column action_type set default 'casper_activity',
    alter column description set default 'Casper activity';

  if has_action then
    execute $sql$
      alter table public.casper_activity_log
        alter column action set default 'casper_activity';
    $sql$;
  end if;

  update public.casper_activity_log
  set action_type = coalesce(action_type, 'casper_activity'),
      description = coalesce(description, 'Casper activity'),
      metadata = coalesce(metadata, '{}'::jsonb)
  where action_type is null or description is null or metadata is null;
end $$;

create index if not exists casper_activity_log_action_idx on public.casper_activity_log (action_type, created_at desc);
create index if not exists casper_activity_log_actor_idx on public.casper_activity_log (actor_id, created_at desc);
create index if not exists casper_activity_log_task_idx on public.casper_activity_log (task_id, created_at desc);

alter table public.casper_integrations
  add column if not exists status text not null default 'disconnected',
  add column if not exists last_used_at timestamptz,
  add column if not exists error_message text,
  add column if not exists updated_at timestamptz not null default now();

update public.casper_integrations
set status = case when enabled then 'connected' else 'disconnected' end,
    updated_at = coalesce(updated_at, now())
where status is null;

create index if not exists casper_integrations_user_idx on public.casper_integrations (user_id, enabled, status);
create index if not exists casper_integrations_key_idx on public.casper_integrations (integration_key, enabled);

alter table public.casper_state
  alter column trending_topics set default '{}'::text[],
  alter column active_user_count set default 0,
  alter column last_network_scan set default now(),
  alter column last_news_fetch set default now(),
  alter column last_updated set default now();

commit;

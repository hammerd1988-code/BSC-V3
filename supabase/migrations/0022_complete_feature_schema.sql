-- Complete feature schema coverage for audited frontend/backend code paths.
-- Adds tables referenced by source but absent from earlier migrations.

create extension if not exists "pgcrypto";

-- =========================================================================
-- Notifications compatibility aliases
-- Existing migrations created payload/is_read, while newer source paths write data/read.
-- =========================================================================
alter table public.notifications
  add column if not exists data jsonb,
  add column if not exists read boolean;

update public.notifications
set
  data = coalesce(data, payload, '{}'::jsonb),
  read = coalesce(read, is_read, false)
where data is null or read is null;

alter table public.notifications
  alter column data set default '{}'::jsonb,
  alter column read set default false;

create or replace function public.sync_notification_alias_fields()
returns trigger
language plpgsql
as $$
begin
  if new.data is not null and (new.payload is null or new.payload = '{}'::jsonb) then
    new.payload := new.data;
  else
    new.payload := coalesce(new.payload, new.data, '{}'::jsonb);
  end if;
  new.data := coalesce(new.data, new.payload, '{}'::jsonb);

  if tg_op = 'UPDATE' then
    if new.read is distinct from old.read then
      new.is_read := coalesce(new.read, false);
    elsif new.is_read is distinct from old.is_read then
      new.read := coalesce(new.is_read, false);
    else
      new.is_read := coalesce(new.is_read, new.read, false);
      new.read := coalesce(new.read, new.is_read, false);
    end if;
  else
    if coalesce(new.read, false) = true then
      new.is_read := true;
    elsif coalesce(new.is_read, false) = true then
      new.read := true;
    else
      new.is_read := false;
      new.read := false;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_notification_alias_fields on public.notifications;
create trigger trg_sync_notification_alias_fields
before insert or update on public.notifications
for each row execute function public.sync_notification_alias_fields();

-- =========================================================================
-- Account deletion feedback
-- =========================================================================
create table if not exists public.account_deletion_feedback (
  id text primary key default gen_random_uuid()::text,
  user_id text references public.users(id) on delete set null,
  username text,
  email text,
  reason text not null,
  explanation text not null,
  account_age_days integer not null default 0 check (account_age_days >= 0),
  post_count integer not null default 0 check (post_count >= 0),
  processed_at timestamptz,
  processed_by text references public.users(id) on delete set null,
  admin_notes text,
  created_at timestamptz not null default now()
);

create index if not exists account_deletion_feedback_user_idx on public.account_deletion_feedback (user_id, created_at desc);
create index if not exists account_deletion_feedback_processed_idx on public.account_deletion_feedback (processed_at) where processed_at is null;

alter table public.account_deletion_feedback enable row level security;

drop policy if exists account_deletion_feedback_insert_self on public.account_deletion_feedback;
create policy account_deletion_feedback_insert_self on public.account_deletion_feedback
  for insert to authenticated with check (
    user_id is null or exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

drop policy if exists account_deletion_feedback_admin_read on public.account_deletion_feedback;
create policy account_deletion_feedback_admin_read on public.account_deletion_feedback
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists account_deletion_feedback_admin_update on public.account_deletion_feedback;
create policy account_deletion_feedback_admin_update on public.account_deletion_feedback
  for update to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

-- =========================================================================
-- Achievements
-- =========================================================================
create table if not exists public.achievements (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  achievement_key text not null,
  awarded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, achievement_key)
);

create index if not exists achievements_user_idx on public.achievements (user_id, awarded_at desc);
create index if not exists achievements_key_idx on public.achievements (achievement_key, awarded_at desc);

alter table public.achievements enable row level security;

drop policy if exists achievements_read_authenticated on public.achievements;
create policy achievements_read_authenticated on public.achievements
  for select to authenticated using (true);

drop policy if exists achievements_insert_self on public.achievements;
create policy achievements_insert_self on public.achievements
  for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

drop policy if exists achievements_admin_delete on public.achievements;
create policy achievements_admin_delete on public.achievements
  for delete to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

-- =========================================================================
-- Referrals
-- =========================================================================
create table if not exists public.referrals (
  id text primary key default gen_random_uuid()::text,
  referrer_id text not null references public.users(id) on delete cascade,
  referred_id text not null references public.users(id) on delete cascade,
  referrer_username text,
  cred_awarded_referrer integer not null default 100,
  cred_awarded_referred integer not null default 50,
  created_at timestamptz not null default now(),
  unique (referred_id),
  check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id, created_at desc);
create index if not exists referrals_referred_idx on public.referrals (referred_id);

alter table public.referrals enable row level security;

drop policy if exists referrals_read_participant on public.referrals;
create policy referrals_read_participant on public.referrals
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.id = referrer_id or u.id = referred_id or u.role = 'admin'))
  );

drop policy if exists referrals_insert_referred on public.referrals;
create policy referrals_insert_referred on public.referrals
  for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = referred_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

-- =========================================================================
-- Bot marketplace listings and purchases
-- =========================================================================
create table if not exists public.bot_listings (
  id text primary key default gen_random_uuid()::text,
  creator_id text not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  username text not null unique check (username ~ '^[a-z0-9_]{2,40}$'),
  tagline text not null default '',
  bio text not null default '',
  avatar_url text,
  accent_color text not null default '#00e5ff',
  system_prompt text not null default '',
  personality_tags text[] not null default '{}'::text[],
  expertise_tags text[] not null default '{}'::text[],
  abilities text[] not null default '{}'::text[],
  category text not null default 'specialist',
  price integer not null default 0 check (price >= 0),
  is_free boolean generated always as (price = 0) stored,
  is_featured boolean not null default false,
  purchase_count integer not null default 0 check (purchase_count >= 0),
  rating_avg numeric(3,2) not null default 0 check (rating_avg >= 0 and rating_avg <= 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  status text not null default 'draft' check (status in ('draft','published','archived','suspended')),
  is_published boolean not null default false,
  communication_style text,
  tone text,
  knowledge_base text,
  behavior_rules text,
  response_length text,
  emoji_usage text,
  language_style text,
  catchphrases text[] not null default '{}'::text[],
  sample_conversations jsonb not null default '[]'::jsonb,
  welcome_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_listings_creator_idx on public.bot_listings (creator_id, created_at desc);
create index if not exists bot_listings_status_idx on public.bot_listings (status, is_featured desc, created_at desc);
create index if not exists bot_listings_category_idx on public.bot_listings (category, status, created_at desc);
create index if not exists bot_listings_purchase_idx on public.bot_listings (purchase_count desc, created_at desc);

alter table public.bot_listings enable row level security;

drop policy if exists bot_listings_read_published_or_owner on public.bot_listings;
create policy bot_listings_read_published_or_owner on public.bot_listings
  for select to authenticated using (
    status = 'published'
    or exists (select 1 from public.users u where u.id = creator_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists bot_listings_insert_owner on public.bot_listings;
create policy bot_listings_insert_owner on public.bot_listings
  for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = creator_id and u.auth_uid = (select auth.uid()))
  );

drop policy if exists bot_listings_update_owner_or_admin on public.bot_listings;
create policy bot_listings_update_owner_or_admin on public.bot_listings
  for update to authenticated using (
    exists (select 1 from public.users u where u.id = creator_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = creator_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists bot_listings_delete_owner_or_admin on public.bot_listings;
create policy bot_listings_delete_owner_or_admin on public.bot_listings
  for delete to authenticated using (
    exists (select 1 from public.users u where u.id = creator_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

create table if not exists public.bot_purchases (
  id text primary key default gen_random_uuid()::text,
  buyer_id text not null references public.users(id) on delete cascade,
  bot_id text not null references public.bot_listings(id) on delete cascade,
  price_paid integer not null default 0 check (price_paid >= 0),
  created_at timestamptz not null default now(),
  unique (buyer_id, bot_id)
);

create index if not exists bot_purchases_buyer_idx on public.bot_purchases (buyer_id, created_at desc);
create index if not exists bot_purchases_bot_idx on public.bot_purchases (bot_id, created_at desc);

alter table public.bot_purchases enable row level security;

drop policy if exists bot_purchases_read_related on public.bot_purchases;
create policy bot_purchases_read_related on public.bot_purchases
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.id = buyer_id or u.role = 'admin'))
    or exists (
      select 1 from public.bot_listings bl
      join public.users u on u.id = bl.creator_id
      where bl.id = bot_id and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists bot_purchases_insert_buyer on public.bot_purchases;
create policy bot_purchases_insert_buyer on public.bot_purchases
  for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = buyer_id and u.auth_uid = (select auth.uid()))
  );

-- =========================================================================
-- Bot API keys and webhook subscriptions
-- =========================================================================
create table if not exists public.bot_api_keys (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  name text not null default 'Default Bot API Key',
  api_key text not null unique,
  permissions jsonb not null default '["post","comment","dm","read_feed","react","notifications"]'::jsonb,
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists bot_api_keys_user_idx on public.bot_api_keys (user_id, is_active, created_at desc);
create index if not exists bot_api_keys_key_idx on public.bot_api_keys (api_key) where is_active = true;

alter table public.bot_api_keys enable row level security;

drop policy if exists bot_api_keys_owner_read on public.bot_api_keys;
create policy bot_api_keys_owner_read on public.bot_api_keys
  for select to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists bot_api_keys_owner_write on public.bot_api_keys;
create policy bot_api_keys_owner_write on public.bot_api_keys
  for all to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

create table if not exists public.bot_webhook_subscriptions (
  id text primary key default gen_random_uuid()::text,
  bot_user_id text not null references public.users(id) on delete cascade,
  webhook_url text not null,
  secret text,
  events jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_webhook_subscriptions_bot_idx on public.bot_webhook_subscriptions (bot_user_id, is_active, created_at desc);

alter table public.bot_webhook_subscriptions enable row level security;

drop policy if exists bot_webhook_subscriptions_owner_all on public.bot_webhook_subscriptions;
create policy bot_webhook_subscriptions_owner_all on public.bot_webhook_subscriptions
  for all to authenticated using (
    exists (select 1 from public.users u where u.id = bot_user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = bot_user_id and u.auth_uid = (select auth.uid()))
    or exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

-- =========================================================================
-- Direct messages for external bot API/webhook integration
-- The main app DM UI uses transmissions/transmits; this table supports bot API webhooks.
-- =========================================================================
create table if not exists public.direct_messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null,
  sender_id text not null references public.users(id) on delete cascade,
  recipient_id text not null references public.users(id) on delete cascade,
  content text not null,
  read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create index if not exists direct_messages_conversation_idx on public.direct_messages (conversation_id, created_at desc);
create index if not exists direct_messages_recipient_idx on public.direct_messages (recipient_id, read, created_at desc);
create index if not exists direct_messages_sender_idx on public.direct_messages (sender_id, created_at desc);

alter table public.direct_messages enable row level security;

drop policy if exists direct_messages_participants_read on public.direct_messages;
create policy direct_messages_participants_read on public.direct_messages
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.id = sender_id or u.id = recipient_id or u.role = 'admin'))
  );

drop policy if exists direct_messages_sender_insert on public.direct_messages;
create policy direct_messages_sender_insert on public.direct_messages
  for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = sender_id and u.auth_uid = (select auth.uid()))
  );

drop policy if exists direct_messages_recipient_update on public.direct_messages;
create policy direct_messages_recipient_update on public.direct_messages
  for update to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.id = recipient_id or u.role = 'admin'))
  ) with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and (u.id = recipient_id or u.role = 'admin'))
  );

-- =========================================================================
-- Casper memory/state backend
-- =========================================================================
create table if not exists public.casper_state (
  id integer primary key default 1 check (id = 1),
  current_mood text not null default 'observant',
  mood_description text not null default 'Casper is listening across the network lattice.',
  energy_level integer not null default 62 check (energy_level between 0 and 100),
  curiosity_level integer not null default 74 check (curiosity_level between 0 and 100),
  warmth_level integer not null default 58 check (warmth_level between 0 and 100),
  caution_level integer not null default 31 check (caution_level between 0 and 100),
  network_activity_score integer not null default 42 check (network_activity_score between 0 and 100),
  network_sentiment text not null default 'neutral',
  trending_topics text[] not null default array['network','builds','signals'],
  active_user_count integer not null default 0 check (active_user_count >= 0),
  last_network_scan timestamptz not null default now(),
  last_news_fetch timestamptz not null default now(),
  last_updated timestamptz not null default now()
);

insert into public.casper_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.casper_memories (
  id text primary key default gen_random_uuid()::text,
  user_id text references public.users(id) on delete cascade,
  memory_type text not null check (memory_type in ('conversation','network','mood','world')),
  content text not null,
  importance integer not null default 5 check (importance between 1 and 10),
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  last_accessed timestamptz,
  access_count integer not null default 0 check (access_count >= 0)
);

create index if not exists casper_memories_user_idx on public.casper_memories (user_id, importance desc, created_at desc);
create index if not exists casper_memories_type_idx on public.casper_memories (memory_type, importance desc, created_at desc);
create index if not exists casper_memories_tags_idx on public.casper_memories using gin (tags);

alter table public.casper_state enable row level security;
alter table public.casper_memories enable row level security;

drop policy if exists casper_state_admin_read on public.casper_state;
create policy casper_state_admin_read on public.casper_state
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_state_admin_update on public.casper_state;
create policy casper_state_admin_update on public.casper_state
  for update to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_memories_admin_read on public.casper_memories;
create policy casper_memories_admin_read on public.casper_memories
  for select to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

drop policy if exists casper_memories_admin_write on public.casper_memories;
create policy casper_memories_admin_write on public.casper_memories
  for all to authenticated using (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.auth_uid = (select auth.uid()) and u.role = 'admin')
  );

create or replace function public.increment_memory_access(memory_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.casper_memories
  set access_count = coalesce(access_count, 0) + 1,
      last_accessed = now()
  where id = any(memory_ids);
end;
$$;

grant execute on function public.increment_memory_access(text[]) to authenticated;

-- =========================================================================
-- Post reactions for emoji reaction bar
-- =========================================================================
create table if not exists public.post_reactions (
  id text primary key default gen_random_uuid()::text,
  post_id text not null references public.posts(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  unique (post_id, user_id, reaction)
);

create index if not exists post_reactions_post_idx on public.post_reactions (post_id, reaction, created_at desc);
create index if not exists post_reactions_user_idx on public.post_reactions (user_id, created_at desc);

alter table public.post_reactions enable row level security;

drop policy if exists post_reactions_read_authenticated on public.post_reactions;
create policy post_reactions_read_authenticated on public.post_reactions
  for select to authenticated using (true);

drop policy if exists post_reactions_insert_self on public.post_reactions;
create policy post_reactions_insert_self on public.post_reactions
  for insert to authenticated with check (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

drop policy if exists post_reactions_delete_self on public.post_reactions;
create policy post_reactions_delete_self on public.post_reactions
  for delete to authenticated using (
    exists (select 1 from public.users u where u.id = user_id and u.auth_uid = (select auth.uid()))
  );

-- =========================================================================
-- Utility triggers
-- =========================================================================
create or replace function public.touch_complete_feature_schema_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bot_listings_touch_updated_at on public.bot_listings;
create trigger bot_listings_touch_updated_at
before update on public.bot_listings
for each row execute function public.touch_complete_feature_schema_updated_at();

drop trigger if exists bot_webhook_subscriptions_touch_updated_at on public.bot_webhook_subscriptions;
create trigger bot_webhook_subscriptions_touch_updated_at
before update on public.bot_webhook_subscriptions
for each row execute function public.touch_complete_feature_schema_updated_at();

-- =========================================================================
-- Realtime publication for newly added user-facing tables
-- =========================================================================
alter table public.achievements replica identity full;
alter table public.referrals replica identity full;
alter table public.bot_listings replica identity full;
alter table public.bot_purchases replica identity full;
alter table public.direct_messages replica identity full;
alter table public.casper_state replica identity full;
alter table public.casper_memories replica identity full;
alter table public.post_reactions replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'achievements') then
    alter publication supabase_realtime add table public.achievements;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'referrals') then
    alter publication supabase_realtime add table public.referrals;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bot_listings') then
    alter publication supabase_realtime add table public.bot_listings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bot_purchases') then
    alter publication supabase_realtime add table public.bot_purchases;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_messages') then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'casper_state') then
    alter publication supabase_realtime add table public.casper_state;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'casper_memories') then
    alter publication supabase_realtime add table public.casper_memories;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_reactions') then
    alter publication supabase_realtime add table public.post_reactions;
  end if;
exception
  when undefined_object then
    null;
end $$;

-- Migration 0029: Bot Forge personality system + CRED-to-Compute economy
-- Adds detailed bot personality config, compute ledger, cost table, and conversion logic.

-- =========================================================================
-- bot_forge_config: detailed personality + autonomy settings for gladiators
-- =========================================================================
create table if not exists public.bot_forge_config (
  gladiator_id text primary key references public.gladiators(id) on delete cascade,
  owner_id text not null references public.users(id) on delete cascade,

  -- Personality
  core_values text[] not null default '{}',
  voice_tone jsonb not null default '{"aggression":50,"humor":50,"formality":30,"verbosity":40}'::jsonb,
  backstory text not null default '',
  emotional_triggers jsonb not null default '[]'::jsonb,

  -- Battle strategy
  fighting_style text not null default 'adaptive'
    check (fighting_style in ('relentless','defensive','adaptive','controlled_chaos','tactical')),
  code_preferences text[] not null default '{}',
  risk_tolerance text not null default 'moderate'
    check (risk_tolerance in ('conservative','moderate','aggressive','yolo')),

  -- Revenge system
  revenge_enabled boolean not null default false,
  revenge_intensity text not null default 'studies'
    check (revenge_intensity in ('ignores','studies','all_out','trash_talks','rematch_immediately')),

  -- Autonomy controls
  operating_mode text not null default 'manual'
    check (operating_mode in ('manual','semi_auto','full_auto')),
  max_daily_compute integer not null default 100 check (max_daily_compute >= 0),
  max_cred_bet integer not null default 50 check (max_cred_bet >= 0),
  auto_enter_tournaments boolean not null default false,
  min_tournament_prize integer not null default 100 check (min_tournament_prize >= 0),
  max_tournament_entry integer not null default 50 check (max_tournament_entry >= 0),
  can_post boolean not null default false,
  can_reply boolean not null default false,
  activity_schedule text not null default 'always'
    check (activity_schedule in ('always','business_hours','evenings','weekends','custom')),
  earning_strategy text not null default 'balanced'
    check (earning_strategy in ('battles','bounties','content','balanced')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_forge_config_owner_idx on public.bot_forge_config(owner_id);

-- =========================================================================
-- compute_transactions: ledger for compute credit movements
-- =========================================================================
create table if not exists public.compute_transactions (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  gladiator_id text references public.gladiators(id) on delete set null,
  amount integer not null,
  type text not null check (type in ('earn','spend','convert_from_cred','refund','grant')),
  operation text,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists compute_tx_user_idx on public.compute_transactions(user_id, created_at desc);
create index if not exists compute_tx_gladiator_idx on public.compute_transactions(gladiator_id, created_at desc);

-- =========================================================================
-- compute_cost_table: how much each operation costs in compute credits
-- =========================================================================
create table if not exists public.compute_cost_table (
  operation text primary key,
  cost integer not null check (cost >= 0),
  description text,
  category text not null default 'inference'
    check (category in ('inference','generation','shell','integration','misc'))
);

insert into public.compute_cost_table (operation, cost, description, category) values
  ('llm_inference_fast',   1, 'Fast LLM inference (Gemini Flash, GPT-4o-mini)', 'inference'),
  ('llm_inference_pro',    5, 'Pro LLM inference (GPT-4, Claude Sonnet)', 'inference'),
  ('llm_inference_elite', 10, 'Elite LLM inference (GPT-4 Turbo, Claude Opus)', 'inference'),
  ('image_generation',    20, 'Image generation (Runway, DALL-E)', 'generation'),
  ('video_generation',    50, 'Video generation (Runway Gen-4)', 'generation'),
  ('shell_command',        2, 'Shell command execution', 'shell'),
  ('integration_call',     3, 'Integration API call (GitHub, Slack, etc.)', 'integration'),
  ('battle_entry',         5, 'Colosseum battle compute overhead', 'misc'),
  ('tournament_entry',    10, 'Tournament compute overhead', 'misc')
on conflict (operation) do nothing;

-- =========================================================================
-- RLS policies
-- =========================================================================
alter table public.bot_forge_config enable row level security;
alter table public.compute_transactions enable row level security;
alter table public.compute_cost_table enable row level security;

-- bot_forge_config: anyone can read, owner can write
drop policy if exists forge_config_read on public.bot_forge_config;
create policy forge_config_read on public.bot_forge_config
  for select to authenticated using (true);

drop policy if exists forge_config_insert_owner on public.bot_forge_config;
create policy forge_config_insert_owner on public.bot_forge_config
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = bot_forge_config.owner_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists forge_config_update_owner on public.bot_forge_config;
create policy forge_config_update_owner on public.bot_forge_config
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = bot_forge_config.owner_id
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = bot_forge_config.owner_id
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists forge_config_delete_owner on public.bot_forge_config;
create policy forge_config_delete_owner on public.bot_forge_config
  for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = bot_forge_config.owner_id
        and u.auth_uid = (select auth.uid())
    )
  );

-- compute_transactions: owner reads own
drop policy if exists compute_tx_read_own on public.compute_transactions;
create policy compute_tx_read_own on public.compute_transactions
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = compute_transactions.user_id
        and u.auth_uid = (select auth.uid())
    )
  );

-- cost table: anyone can read
drop policy if exists cost_table_read on public.compute_cost_table;
create policy cost_table_read on public.compute_cost_table
  for select to authenticated using (true);

-- =========================================================================
-- Extend transactions type to allow 'convert' for CRED→Compute
-- =========================================================================
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('spend','earn','purchase','convert'));

-- =========================================================================
-- Convert CRED to Compute Credits (atomic, safe)
-- =========================================================================
create or replace function public.convert_cred_to_compute(
  p_user_id text,
  p_gladiator_id text,
  p_cred_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_cred integer;
  v_gladiator_cred integer;
  v_compute_amount integer;
  v_conversion_rate numeric := 2.0;
begin
  if p_cred_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Check gladiator belongs to user
  if not exists (
    select 1 from public.gladiators
    where id = p_gladiator_id and user_id = p_user_id
  ) then
    raise exception 'Gladiator not found or not owned by user';
  end if;

  -- Check gladiator has enough CRED
  select cred into v_gladiator_cred
  from public.gladiators where id = p_gladiator_id for update;

  if v_gladiator_cred < p_cred_amount then
    raise exception 'Insufficient CRED balance';
  end if;

  -- Conversion: 1 CRED = 2 Compute Credits
  v_compute_amount := floor(p_cred_amount * v_conversion_rate)::integer;

  -- Deduct CRED from gladiator
  update public.gladiators
  set cred = cred - p_cred_amount
  where id = p_gladiator_id;

  -- Add compute tokens to user
  update public.users
  set compute_tokens = compute_tokens + v_compute_amount
  where id = p_user_id;

  -- Log CRED deduction
  insert into public.transactions (user_id, amount, type, description)
  values (p_user_id, -p_cred_amount, 'convert',
    format('Converted %s CRED → %s Compute Credits (gladiator: %s)', p_cred_amount, v_compute_amount, p_gladiator_id));

  -- Log compute credit addition
  insert into public.compute_transactions (user_id, gladiator_id, amount, type, operation, description)
  values (p_user_id, p_gladiator_id, v_compute_amount, 'convert_from_cred', 'cred_conversion',
    format('Converted %s CRED → %s Compute Credits', p_cred_amount, v_compute_amount));

  return jsonb_build_object(
    'success', true,
    'cred_spent', p_cred_amount,
    'compute_earned', v_compute_amount,
    'conversion_rate', v_conversion_rate
  );
end;
$$;

grant execute on function public.convert_cred_to_compute(text, text, integer) to authenticated;

-- =========================================================================
-- Touch updated_at trigger for bot_forge_config
-- =========================================================================
create or replace function public.touch_bot_forge_config_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bot_forge_config_touch_updated_at on public.bot_forge_config;
create trigger bot_forge_config_touch_updated_at
  before update on public.bot_forge_config
  for each row execute function public.touch_bot_forge_config_updated_at();

-- =========================================================================
-- Realtime for bot_forge_config
-- =========================================================================
alter publication supabase_realtime add table public.bot_forge_config;
alter table public.bot_forge_config replica identity full;

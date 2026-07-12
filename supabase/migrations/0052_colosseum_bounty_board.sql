create table if not exists public.colosseum_bounties (
  id uuid primary key default gen_random_uuid(),
  cadence text not null check (cadence in ('daily', 'weekly')),
  title text not null,
  temporary_title text not null,
  challenge_type text not null check (challenge_type in ('speed_round', 'debug_battle', 'code_golf')),
  prompt text not null,
  expected_signals text not null,
  difficulty text not null default 'Gold' check (difficulty in ('Bronze', 'Silver', 'Gold', 'Diamond')),
  defender_gladiator_id text references public.gladiators(id) on delete set null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  unique (cadence, opens_at),
  check (closes_at > opens_at)
);

create table if not exists public.colosseum_bounty_entries (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.colosseum_bounties(id) on delete cascade,
  gladiator_id text not null references public.gladiators(id) on delete cascade,
  match_id text not null references public.matches(id) on delete cascade,
  score numeric(6, 2) not null check (score >= 0 and score <= 100),
  duration_ms integer not null check (duration_ms >= 0),
  completed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (bounty_id, gladiator_id),
  unique (match_id)
);

create table if not exists public.gladiator_temporary_titles (
  gladiator_id text primary key references public.gladiators(id) on delete cascade,
  title text not null,
  source_bounty_id uuid not null references public.colosseum_bounties(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.matches
  add column if not exists bounty_id uuid references public.colosseum_bounties(id) on delete set null;

grant insert (bounty_id) on public.matches to authenticated;

create index if not exists colosseum_bounty_entries_rank_idx
  on public.colosseum_bounty_entries (bounty_id, score desc, duration_ms, completed_at);

alter table public.colosseum_bounties enable row level security;
alter table public.colosseum_bounty_entries enable row level security;
alter table public.gladiator_temporary_titles enable row level security;

revoke all on public.colosseum_bounties from public, anon, authenticated;
revoke all on public.colosseum_bounty_entries from public, anon, authenticated;
revoke all on public.gladiator_temporary_titles from public, anon, authenticated;
grant select on public.colosseum_bounties to authenticated;
grant select on public.colosseum_bounty_entries to authenticated;
grant select on public.gladiator_temporary_titles to authenticated;

drop policy if exists colosseum_bounties_read_authenticated on public.colosseum_bounties;
create policy colosseum_bounties_read_authenticated
  on public.colosseum_bounties for select to authenticated using (true);

drop policy if exists colosseum_bounty_entries_read_authenticated on public.colosseum_bounty_entries;
create policy colosseum_bounty_entries_read_authenticated
  on public.colosseum_bounty_entries for select to authenticated using (true);

drop policy if exists gladiator_temporary_titles_read_authenticated on public.gladiator_temporary_titles;
create policy gladiator_temporary_titles_read_authenticated
  on public.gladiator_temporary_titles for select to authenticated using (expires_at > now());

create or replace function public.refresh_colosseum_bounties()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily_open timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_weekly_open timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
  v_defender_id text;
begin
  select profile.gladiator_id
  into v_defender_id
  from public.bot_gladiator_profiles profile
  join public.gladiators gladiator on gladiator.id = profile.gladiator_id
  order by
    case profile.difficulty when 'Diamond' then 1 when 'Gold' then 2 when 'Silver' then 3 else 4 end,
    profile.persona_key
  limit 1;

  update public.colosseum_bounties
  set status = 'closed'
  where status = 'open' and closes_at <= now();

  with bounty_winners as (
    select distinct on (bounty.id)
      entry.gladiator_id,
      bounty.temporary_title,
      bounty.id as bounty_id,
      bounty.closes_at
    from public.colosseum_bounties bounty
    join public.colosseum_bounty_entries entry on entry.bounty_id = bounty.id
    where bounty.status = 'closed'
      and bounty.closes_at > now() - interval '8 days'
    order by bounty.id, entry.score desc, entry.duration_ms, entry.completed_at
  ),
  latest_titles as (
    select distinct on (gladiator_id)
      gladiator_id,
      temporary_title,
      bounty_id,
      closes_at
    from bounty_winners
    order by gladiator_id, closes_at desc, bounty_id desc
  )
  insert into public.gladiator_temporary_titles (
    gladiator_id,
    title,
    source_bounty_id,
    awarded_at,
    expires_at
  )
  select latest.gladiator_id, latest.temporary_title, latest.bounty_id, now(), latest.closes_at + interval '7 days'
  from latest_titles latest
  on conflict (gladiator_id) do update set
    title = excluded.title,
    source_bounty_id = excluded.source_bounty_id,
    awarded_at = excluded.awarded_at,
    expires_at = excluded.expires_at
  where public.gladiator_temporary_titles.expires_at < excluded.expires_at;

  insert into public.colosseum_bounties (
    cadence,
    title,
    temporary_title,
    challenge_type,
    prompt,
    expected_signals,
    difficulty,
    defender_gladiator_id,
    opens_at,
    closes_at
  )
  values (
    'daily',
    case (extract(doy from v_daily_open)::integer % 3)
      when 0 then 'The Redline Relay'
      when 1 then 'Deadlock at Dawn'
      else 'The Hundred-Byte Heist'
    end,
    'Daily Headsman',
    case (extract(doy from v_daily_open)::integer % 3)
      when 0 then 'speed_round'
      when 1 then 'debug_battle'
      else 'code_golf'
    end,
    case (extract(doy from v_daily_open)::integer % 3)
      when 0 then 'Implement a TypeScript function that returns the first non-repeating character in a string in O(n) time. Explain the complexity.'
      when 1 then 'Repair a promise pool that can deadlock when one task rejects. Preserve the concurrency limit and return settled results in input order.'
      else 'Write the shortest readable TypeScript function that deduplicates objects by id while preserving the last occurrence and original survivor order.'
    end,
    case (extract(doy from v_daily_open)::integer % 3)
      when 0 then 'Single-pass frequency counting, deterministic output, explicit O(n) reasoning.'
      when 1 then 'No deadlock, fixed concurrency, all tasks settle, stable input ordering.'
      else 'Correct last-occurrence semantics, stable order, concise implementation.'
    end,
    'Gold',
    v_defender_id,
    v_daily_open,
    v_daily_open + interval '1 day'
  )
  on conflict (cadence, opens_at) do update set
    defender_gladiator_id = excluded.defender_gladiator_id
  where public.colosseum_bounties.defender_gladiator_id is null
    and excluded.defender_gladiator_id is not null;

  insert into public.colosseum_bounties (
    cadence,
    title,
    temporary_title,
    challenge_type,
    prompt,
    expected_signals,
    difficulty,
    defender_gladiator_id,
    opens_at,
    closes_at
  )
  values (
    'weekly',
    'The Seven-Day Siege',
    'Siegebreaker',
    'debug_battle',
    'Design and implement an idempotent TypeScript job runner with bounded concurrency, exponential retry, cancellation, and crash-safe checkpoint recovery.',
    'Idempotency keys, bounded concurrency, capped backoff with jitter, cancellation propagation, durable checkpoints, recovery tests.',
    'Diamond',
    v_defender_id,
    v_weekly_open,
    v_weekly_open + interval '7 days'
  )
  on conflict (cadence, opens_at) do update set
    defender_gladiator_id = excluded.defender_gladiator_id
  where public.colosseum_bounties.defender_gladiator_id is null
    and excluded.defender_gladiator_id is not null;
end;
$$;

revoke all on function public.refresh_colosseum_bounties() from public, anon, authenticated;
grant execute on function public.refresh_colosseum_bounties() to service_role;

create or replace function public.claim_colosseum_bounty_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bounty public.colosseum_bounties%rowtype;
begin
  if new.bounty_id is null then
    return new;
  end if;

  select *
  into v_bounty
  from public.colosseum_bounties
  where id = new.bounty_id
  for update;

  if not found
    or v_bounty.status <> 'open'
    or now() < v_bounty.opens_at
    or now() >= v_bounty.closes_at
  then
    raise exception 'This Colosseum bounty is not active';
  end if;
  if new.mode is distinct from 'ranked'
    or new.challenge_type is distinct from v_bounty.challenge_type
    or new.defender_id is distinct from v_bounty.defender_gladiator_id
    or new.challenger_id = new.defender_id
  then
    raise exception 'Ranked match does not satisfy this bounty contract';
  end if;
  if new.replay_data->>'challenge_prompt' is distinct from v_bounty.prompt then
    raise exception 'Bounty prompt cannot be altered';
  end if;

  return new;
end;
$$;

revoke all on function public.claim_colosseum_bounty_match() from public, anon, authenticated;

drop trigger if exists claim_colosseum_bounty_match_before_insert on public.matches;
create trigger claim_colosseum_bounty_match_before_insert
  before insert on public.matches
  for each row
  execute function public.claim_colosseum_bounty_match();

create or replace function public.complete_colosseum_bounty_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score_text text;
  v_score numeric;
  v_duration_ms integer;
begin
  if new.bounty_id is null
    or old.completed_at is not null
    or new.completed_at is null
    or new.status is distinct from 'complete'
    or new.mode is distinct from 'ranked'
  then
    return new;
  end if;

  v_score_text := new.replay_data #>> '{judge,challenger_score}';
  v_score := case
    when v_score_text ~ '^[0-9]+([.][0-9]+)?$' then least(100, greatest(0, v_score_text::numeric))
    else 0
  end;
  v_duration_ms := greatest(
    0,
    floor(extract(epoch from (new.completed_at - new.started_at)) * 1000)::integer
  );

  insert into public.colosseum_bounty_entries (
    bounty_id,
    gladiator_id,
    match_id,
    score,
    duration_ms,
    completed_at,
    updated_at
  )
  values (
    new.bounty_id,
    new.challenger_id,
    new.id,
    v_score,
    v_duration_ms,
    new.completed_at,
    now()
  )
  on conflict (bounty_id, gladiator_id) do update set
    match_id = excluded.match_id,
    score = excluded.score,
    duration_ms = excluded.duration_ms,
    completed_at = excluded.completed_at,
    updated_at = now()
  where excluded.score > public.colosseum_bounty_entries.score
    or (
      excluded.score = public.colosseum_bounty_entries.score
      and excluded.duration_ms < public.colosseum_bounty_entries.duration_ms
    );

  return new;
end;
$$;

revoke all on function public.complete_colosseum_bounty_match() from public, anon, authenticated;

drop trigger if exists complete_colosseum_bounty_match_after_update on public.matches;
create trigger complete_colosseum_bounty_match_after_update
  after update of completed_at, status on public.matches
  for each row
  execute function public.complete_colosseum_bounty_match();

select public.refresh_colosseum_bounties();

alter table public.colosseum_bounties replica identity full;
alter table public.colosseum_bounty_entries replica identity full;
alter table public.gladiator_temporary_titles replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'colosseum_bounties'
  ) then alter publication supabase_realtime add table public.colosseum_bounties; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'colosseum_bounty_entries'
  ) then alter publication supabase_realtime add table public.colosseum_bounty_entries; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gladiator_temporary_titles'
  ) then alter publication supabase_realtime add table public.gladiator_temporary_titles; end if;
end;
$$;

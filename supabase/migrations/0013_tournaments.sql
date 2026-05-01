-- =========================================================================
-- Colosseum Sapphire house bot + tournament system
-- =========================================================================

create extension if not exists "pgcrypto";

-- Seed Sapphire as a durable house bot identity. The constant UUID-shaped IDs
-- remain valid in databases that store IDs as either uuid or text.
insert into public.users (
  id,
  username,
  display_name,
  email,
  avatar_url,
  bio,
  type,
  role,
  cred_balance,
  compute_tokens,
  custom_accent,
  status_message,
  ai_settings
)
values (
  '00000000-0000-4000-8000-00000000b5c0',
  'sapphire',
  'Sapphire',
  'sapphire@bloodsweatcode.site',
  null,
  'House AI gladiator wired into the Colosseum. Sapphire fights with live code responses instead of canned simulations.',
  'bot',
  'user',
  5000,
  1000,
  '#38bdf8',
  'Awaiting the next live code duel.',
  '{"model":"sapphire-live","house_bot":true}'::jsonb
)
on conflict (username) do update
set
  display_name = excluded.display_name,
  bio = excluded.bio,
  type = 'bot',
  custom_accent = excluded.custom_accent,
  status_message = excluded.status_message,
  ai_settings = excluded.ai_settings;

insert into public.gladiators (
  id,
  user_id,
  name,
  avatar_url,
  personality,
  stats,
  glow_color,
  wins,
  losses,
  cred
)
select
  '00000000-0000-4000-8000-00000000fa11',
  u.id,
  'Sapphire',
  u.avatar_url,
  'A real house AI opponent from the blue furnace: precise, observant, and dangerous under pressure. Sapphire sends live solutions through her own API instead of relying on pit theatrics.',
  '{"speed":88,"accuracy":94,"endurance":86}'::jsonb,
  '#38bdf8',
  0,
  0,
  2500
from public.users u
where u.username = 'sapphire'
on conflict (id) do update
set
  user_id = excluded.user_id,
  name = excluded.name,
  personality = excluded.personality,
  stats = excluded.stats,
  glow_color = excluded.glow_color,
  cred = greatest(public.gladiators.cred, excluded.cred);

-- Tournaments intentionally store IDs as uuid. Where they reference existing
-- Colosseum records, policies compare through ::text casts so this migration
-- remains compatible with older text-backed local schemas and uuid production schemas.
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 3 and 120),
  challenge_type text not null check (challenge_type in ('speed_round', 'debug_battle', 'code_golf')),
  min_contestants integer not null default 4 check (min_contestants >= 2),
  status text not null default 'open' check (status in ('open', 'scheduled', 'running', 'completed', 'cancelled')),
  scheduled_at timestamptz,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  bracket jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  gladiator_id uuid not null,
  user_id uuid,
  seed integer,
  joined_at timestamptz not null default now(),
  unique (tournament_id, gladiator_id)
);

create index if not exists tournaments_status_idx on public.tournaments (status, scheduled_at);
create index if not exists tournament_entries_tournament_idx on public.tournament_entries (tournament_id, seed, joined_at);
create index if not exists tournament_entries_gladiator_idx on public.tournament_entries (gladiator_id);

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;

drop policy if exists tournaments_read_authenticated on public.tournaments;
create policy tournaments_read_authenticated on public.tournaments
  for select
  to authenticated
  using (true);

drop policy if exists tournaments_insert_authenticated on public.tournaments;
create policy tournaments_insert_authenticated on public.tournaments
  for insert
  to authenticated
  with check (true);

drop policy if exists tournaments_update_creator on public.tournaments;
create policy tournaments_update_creator on public.tournaments
  for update
  to authenticated
  using (
    created_by is null
    or exists (
      select 1
      from public.users u
      where u.id::text = tournaments.created_by::text
        and u.auth_uid = (select auth.uid())
    )
  )
  with check (
    created_by is null
    or exists (
      select 1
      from public.users u
      where u.id::text = tournaments.created_by::text
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists tournament_entries_read_authenticated on public.tournament_entries;
create policy tournament_entries_read_authenticated on public.tournament_entries
  for select
  to authenticated
  using (true);

drop policy if exists tournament_entries_insert_owner on public.tournament_entries;
create policy tournament_entries_insert_owner on public.tournament_entries
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.tournaments t
      where t.id = tournament_entries.tournament_id
        and t.status = 'open'
    )
    and exists (
      select 1
      from public.gladiators g
      join public.users u on u.id::text = g.user_id::text
      where g.id::text = tournament_entries.gladiator_id::text
        and u.auth_uid = (select auth.uid())
    )
  );

drop policy if exists tournament_entries_delete_owner on public.tournament_entries;
create policy tournament_entries_delete_owner on public.tournament_entries
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.tournaments t
      where t.id = tournament_entries.tournament_id
        and t.status = 'open'
    )
    and exists (
      select 1
      from public.gladiators g
      join public.users u on u.id::text = g.user_id::text
      where g.id::text = tournament_entries.gladiator_id::text
        and u.auth_uid = (select auth.uid())
    )
  );

create or replace function public.touch_tournament_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tournaments_touch_updated_at on public.tournaments;
create trigger tournaments_touch_updated_at
before update on public.tournaments
for each row execute function public.touch_tournament_updated_at();

create or replace function public.lock_tournament_at_threshold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_min integer;
  v_status text;
begin
  select count(*), t.min_contestants, t.status
    into v_count, v_min, v_status
  from public.tournaments t
  left join public.tournament_entries e on e.tournament_id = t.id
  where t.id = new.tournament_id
  group by t.id, t.min_contestants, t.status;

  if v_status = 'open' and v_count >= v_min then
    update public.tournaments
    set
      status = 'scheduled',
      locked_at = coalesce(locked_at, now()),
      scheduled_at = coalesce(scheduled_at, now() + interval '24 hours')
    where id = new.tournament_id;

    with ranked as (
      select id, row_number() over (order by joined_at asc, id asc) as rn
      from public.tournament_entries
      where tournament_id = new.tournament_id
    )
    update public.tournament_entries e
    set seed = ranked.rn
    from ranked
    where e.id = ranked.id;
  end if;

  return new;
end;
$$;

drop trigger if exists tournament_entries_lock_threshold on public.tournament_entries;
create trigger tournament_entries_lock_threshold
after insert on public.tournament_entries
for each row execute function public.lock_tournament_at_threshold();

create or replace function public.start_due_tournaments()
returns setof public.tournaments
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select t.id
    from public.tournaments t
    where t.status = 'scheduled'
      and t.scheduled_at is not null
      and t.scheduled_at <= now()
  ),
  bracket_rows as (
    select
      e.tournament_id,
      jsonb_agg(
        jsonb_build_object(
          'round', 1,
          'match', ceil(e.seed::numeric / 2)::int,
          'seed', e.seed,
          'gladiator_id', e.gladiator_id,
          'entry_id', e.id
        )
        order by e.seed
      ) as bracket
    from public.tournament_entries e
    join due on due.id = e.tournament_id
    group by e.tournament_id
  )
  update public.tournaments t
  set
    status = 'running',
    started_at = coalesce(started_at, now()),
    bracket = coalesce(bracket_rows.bracket, '[]'::jsonb)
  from bracket_rows
  where t.id = bracket_rows.tournament_id
  returning t.*;
end;
$$;

grant execute on function public.start_due_tournaments() to authenticated;

alter publication supabase_realtime add table public.tournaments;
alter publication supabase_realtime add table public.tournament_entries;
alter table public.tournaments replica identity full;
alter table public.tournament_entries replica identity full;

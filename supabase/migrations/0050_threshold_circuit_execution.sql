alter table public.tournaments
  add column if not exists champion_gladiator_id uuid;

revoke insert, update on public.tournaments from authenticated;
grant insert (name, challenge_type, min_contestants, created_by)
  on public.tournaments
  to authenticated;

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  position integer not null check (position >= 1),
  slot_a_gladiator_id uuid,
  slot_b_gladiator_id uuid,
  winner_gladiator_id uuid,
  match_id text references public.matches(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'running', 'complete')),
  resolution text check (resolution in ('battle', 'bye')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, round_number, position)
);

alter table public.matches
  add column if not exists tournament_match_id uuid references public.tournament_matches(id) on delete set null;

revoke insert on public.matches from authenticated;
grant insert (challenger_id, defender_id, challenge_type, replay_data, tournament_match_id)
  on public.matches
  to authenticated;

create unique index if not exists tournament_matches_ranked_match_idx
  on public.tournament_matches (match_id)
  where match_id is not null;

create index if not exists tournament_matches_circuit_idx
  on public.tournament_matches (tournament_id, round_number, position);

alter table public.tournament_matches enable row level security;
revoke all on public.tournament_matches from public;
revoke all on public.tournament_matches from anon;
revoke all on public.tournament_matches from authenticated;
grant select on public.tournament_matches to authenticated;

drop policy if exists tournament_matches_read_authenticated on public.tournament_matches;
create policy tournament_matches_read_authenticated
  on public.tournament_matches
  for select
  to authenticated
  using (true);

create or replace function public.refresh_threshold_bracket(p_tournament_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tournaments t
  set bracket = coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', tm.id,
        'round', tm.round_number,
        'match', tm.position,
        'slot_a_gladiator_id', tm.slot_a_gladiator_id,
        'slot_b_gladiator_id', tm.slot_b_gladiator_id,
        'winner_gladiator_id', tm.winner_gladiator_id,
        'match_id', tm.match_id,
        'status', tm.status,
        'resolution', tm.resolution
      )
      order by tm.round_number, tm.position
    )
    from public.tournament_matches tm
    where tm.tournament_id = p_tournament_id
  ), '[]'::jsonb)
  where t.id = p_tournament_id;
$$;

create or replace function public.advance_threshold_match(
  p_tournament_match_id uuid,
  p_winner_gladiator_id uuid,
  p_match_id text default null,
  p_resolution text default 'battle'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_node public.tournament_matches%rowtype;
  v_final_round integer;
  v_next_id uuid;
  v_next_position integer;
  v_slot_a uuid;
  v_slot_b uuid;
  v_feeders_complete integer;
begin
  select *
  into v_node
  from public.tournament_matches
  where id = p_tournament_match_id
  for update;

  if not found then
    raise exception 'Threshold Circuit match not found';
  end if;
  if p_winner_gladiator_id not in (v_node.slot_a_gladiator_id, v_node.slot_b_gladiator_id) then
    raise exception 'Winner is not a Threshold Circuit combatant';
  end if;
  if p_match_id is not null and v_node.match_id is distinct from p_match_id then
    raise exception 'Ranked match does not own this Threshold Circuit node';
  end if;
  if v_node.status = 'complete' then
    if v_node.winner_gladiator_id is distinct from p_winner_gladiator_id then
      raise exception 'Threshold Circuit node already has a different winner';
    end if;
    return;
  end if;

  update public.tournament_matches
  set
    winner_gladiator_id = p_winner_gladiator_id,
    status = 'complete',
    resolution = p_resolution,
    completed_at = now(),
    updated_at = now()
  where id = p_tournament_match_id;

  select max(round_number)
  into v_final_round
  from public.tournament_matches
  where tournament_id = v_node.tournament_id;

  if v_node.round_number = v_final_round then
    update public.tournaments
    set
      status = 'completed',
      champion_gladiator_id = p_winner_gladiator_id,
      completed_at = now()
    where id = v_node.tournament_id;
    perform public.refresh_threshold_bracket(v_node.tournament_id);
    return;
  end if;

  v_next_position := ceil(v_node.position::numeric / 2)::integer;
  select id
  into v_next_id
  from public.tournament_matches
  where tournament_id = v_node.tournament_id
    and round_number = v_node.round_number + 1
    and position = v_next_position
  for update;

  if mod(v_node.position, 2) = 1 then
    update public.tournament_matches
    set slot_a_gladiator_id = p_winner_gladiator_id, updated_at = now()
    where id = v_next_id;
  else
    update public.tournament_matches
    set slot_b_gladiator_id = p_winner_gladiator_id, updated_at = now()
    where id = v_next_id;
  end if;

  select
    slot_a_gladiator_id,
    slot_b_gladiator_id
  into v_slot_a, v_slot_b
  from public.tournament_matches
  where id = v_next_id;

  select count(*)::integer
  into v_feeders_complete
  from public.tournament_matches
  where tournament_id = v_node.tournament_id
    and round_number = v_node.round_number
    and position in (v_next_position * 2 - 1, v_next_position * 2)
    and status = 'complete';

  if v_feeders_complete = 2 then
    if v_slot_a is not null and v_slot_b is not null then
      update public.tournament_matches
      set status = 'ready', updated_at = now()
      where id = v_next_id;
    elsif coalesce(v_slot_a, v_slot_b) is not null then
      perform public.advance_threshold_match(v_next_id, coalesce(v_slot_a, v_slot_b), null, 'bye');
    end if;
  end if;

  perform public.refresh_threshold_bracket(v_node.tournament_id);
end;
$$;

create or replace function public.initialize_threshold_circuit(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_bracket_size integer;
  v_rounds integer;
  v_round integer;
  v_position integer;
  v_node record;
begin
  select count(*)::integer
  into v_count
  from public.tournament_entries
  where tournament_id = p_tournament_id;

  if v_count < 2 then
    raise exception 'Threshold Circuit requires at least two entrants';
  end if;

  v_bracket_size := power(2, ceil(log(2, v_count::numeric)))::integer;
  v_rounds := ceil(log(2, v_bracket_size::numeric))::integer;

  delete from public.tournament_matches where tournament_id = p_tournament_id;

  for v_round in 1..v_rounds loop
    for v_position in 1..(v_bracket_size / power(2, v_round)::integer) loop
      insert into public.tournament_matches (tournament_id, round_number, position)
      values (p_tournament_id, v_round, v_position);
    end loop;
  end loop;

  update public.tournament_matches tm
  set
    slot_a_gladiator_id = (
      select e.gladiator_id
      from public.tournament_entries e
      where e.tournament_id = p_tournament_id
        and e.seed = tm.position
    ),
    slot_b_gladiator_id = (
      select e.gladiator_id
      from public.tournament_entries e
      where e.tournament_id = p_tournament_id
        and e.seed = v_bracket_size + 1 - tm.position
    )
  where tm.tournament_id = p_tournament_id
    and tm.round_number = 1;

  update public.tournament_matches
  set status = 'ready', updated_at = now()
  where tournament_id = p_tournament_id
    and round_number = 1
    and slot_a_gladiator_id is not null
    and slot_b_gladiator_id is not null;

  update public.tournaments
  set
    status = 'running',
    started_at = coalesce(started_at, now()),
    champion_gladiator_id = null,
    completed_at = null
  where id = p_tournament_id;

  for v_node in
    select id, coalesce(slot_a_gladiator_id, slot_b_gladiator_id) as winner_id
    from public.tournament_matches
    where tournament_id = p_tournament_id
      and round_number = 1
      and status = 'waiting'
      and coalesce(slot_a_gladiator_id, slot_b_gladiator_id) is not null
    order by position
  loop
    perform public.advance_threshold_match(v_node.id, v_node.winner_id, null, 'bye');
  end loop;

  perform public.refresh_threshold_bracket(p_tournament_id);
end;
$$;

create or replace function public.start_due_tournaments()
returns setof public.tournaments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
begin
  for v_tournament_id in
    select id
    from public.tournaments
    where status = 'scheduled'
      and scheduled_at is not null
      and scheduled_at <= now()
    order by scheduled_at
    for update skip locked
  loop
    perform public.initialize_threshold_circuit(v_tournament_id);
  end loop;

  return query
  select *
  from public.tournaments
  where status = 'running'
  order by started_at desc;
end;
$$;

create or replace function public.claim_threshold_circuit_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_node public.tournament_matches%rowtype;
  v_challenge_type text;
  v_tournament_status text;
begin
  if new.tournament_match_id is null then
    return new;
  end if;

  select *
  into v_node
  from public.tournament_matches
  where id = new.tournament_match_id
  for update;

  if found then
    select challenge_type, status
    into v_challenge_type, v_tournament_status
    from public.tournaments
    where id = v_node.tournament_id;
  end if;

  if not found
    or v_tournament_status <> 'running'
    or v_node.status <> 'ready'
    or v_node.match_id is not null
  then
    raise exception 'Threshold Circuit node is not ready';
  end if;
  if new.mode is distinct from 'ranked' or new.challenge_type is distinct from v_challenge_type then
    raise exception 'Threshold Circuit terms cannot be changed';
  end if;
  if not (
    new.challenger_id in (v_node.slot_a_gladiator_id::text, v_node.slot_b_gladiator_id::text)
    and new.defender_id in (v_node.slot_a_gladiator_id::text, v_node.slot_b_gladiator_id::text)
    and new.challenger_id <> new.defender_id
  ) then
    raise exception 'Threshold Circuit combatants do not match this node';
  end if;

  update public.tournament_matches
  set
    match_id = new.id,
    status = 'running',
    started_at = now(),
    updated_at = now()
  where id = new.tournament_match_id;

  return new;
end;
$$;

drop trigger if exists claim_threshold_circuit_match_after_insert on public.matches;
create trigger claim_threshold_circuit_match_after_insert
  after insert on public.matches
  for each row
  execute function public.claim_threshold_circuit_match();

create or replace function public.complete_threshold_circuit_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tournament_match_id is null
    or old.completed_at is not null
    or new.completed_at is null
    or new.status is distinct from 'complete'
    or new.mode is distinct from 'ranked'
    or new.winner_id not in (new.challenger_id, new.defender_id)
  then
    return new;
  end if;

  perform public.advance_threshold_match(
    new.tournament_match_id,
    new.winner_id::uuid,
    new.id,
    'battle'
  );
  return new;
end;
$$;

drop trigger if exists complete_threshold_circuit_match_after_update on public.matches;
create trigger complete_threshold_circuit_match_after_update
  after update of winner_id, completed_at, status on public.matches
  for each row
  execute function public.complete_threshold_circuit_match();

revoke all on function public.refresh_threshold_bracket(uuid) from public, anon, authenticated;
revoke all on function public.advance_threshold_match(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.initialize_threshold_circuit(uuid) from public, anon, authenticated;
revoke all on function public.claim_threshold_circuit_match() from public, anon, authenticated;
revoke all on function public.complete_threshold_circuit_match() from public, anon, authenticated;
grant execute on function public.start_due_tournaments() to authenticated;

alter table public.tournament_matches replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournament_matches'
  ) then
    alter publication supabase_realtime add table public.tournament_matches;
  end if;
end;
$$;

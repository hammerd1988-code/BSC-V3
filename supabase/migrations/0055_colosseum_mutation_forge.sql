-- Migration 0055: Gladiator Mutation Forge
-- Server-authoritative, permanent single-stat mutations paid from battle-earned gladiator CRED.

-- Make the table safe to re-paste: if an older version used uuid columns, convert them to text
-- to match public.gladiators.id and public.users.id.
alter table if exists public.gladiator_mutations
  alter column gladiator_id type text using gladiator_id::text,
  alter column user_id type text using user_id::text;

create table if not exists public.gladiator_mutations (
  id uuid primary key default gen_random_uuid(),
  gladiator_id text not null references public.gladiators(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  stat_key text not null check (stat_key in ('speed', 'accuracy', 'creativity', 'endurance')),
  mutation_mode text not null check (mutation_mode in ('graft', 'reroll')),
  old_value integer not null check (old_value between 1 and 100),
  new_value integer not null check (new_value between 1 and 100),
  cred_cost integer not null check (cred_cost > 0),
  created_at timestamptz not null default now()
);

create index if not exists gladiator_mutations_gladiator_created_idx
  on public.gladiator_mutations(gladiator_id, created_at desc);

create index if not exists gladiator_mutations_user_created_idx
  on public.gladiator_mutations(user_id, created_at desc);

alter table public.gladiator_mutations enable row level security;

drop policy if exists gladiator_mutations_read_authenticated on public.gladiator_mutations;
create policy gladiator_mutations_read_authenticated on public.gladiator_mutations
  for select
  to authenticated
  using (true);

-- All inserts are performed by the security-definer mutation function.
revoke all on public.gladiator_mutations from anon, authenticated;
grant select on public.gladiator_mutations to authenticated;

-- Battle progression and mutations are the only paths allowed to alter combat stats.
revoke update on public.gladiators from authenticated;
grant update (
  name, avatar_url, personality, glow_color, api_key, model, api_base_url
) on public.gladiators to authenticated;

-- Remove the old uuid-parameter overload if it exists before creating the correct one.
drop function if exists public.mutate_colosseum_gladiator(uuid, text, text);

create or replace function public.mutate_colosseum_gladiator(
  p_gladiator_id text,
  p_stat_key text,
  p_mutation_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gladiator public.gladiators%rowtype;
  v_user_id text;
  v_old_value integer;
  v_new_value integer;
  v_delta integer;
  v_cost integer;
  v_cred_remaining integer;
  v_stats jsonb;
  v_last_mutation_at timestamptz;
  v_mutation_id uuid;
  v_mutated_at timestamptz;
begin
  select arena_gladiator.*, arena_user.id
  into v_gladiator, v_user_id
  from public.gladiators arena_gladiator
  join public.users arena_user on arena_user.id = arena_gladiator.user_id
  where arena_gladiator.id = p_gladiator_id
    and arena_user.auth_uid = auth.uid()
  for update of arena_gladiator;

  if not found then
    raise exception 'Gladiator not found or you do not own it';
  end if;

  -- Active match lock: use the same source of truth as the frontend (completed_at).
  if exists (
    select 1
    from public.matches arena_match
    where p_gladiator_id in (arena_match.challenger_id, arena_match.defender_id)
      and arena_match.completed_at is null
  ) then
    raise exception 'Mutation Forge is locked while this gladiator has an active match';
  end if;

  if p_stat_key not in ('speed', 'accuracy', 'creativity', 'endurance') then
    raise exception 'Invalid mutation stat key: %', p_stat_key;
  end if;

  if p_mutation_mode = 'graft' then
    v_cost := 180;
  elsif p_mutation_mode = 'reroll' then
    v_cost := 90;
  else
    raise exception 'Invalid mutation mode: %', p_mutation_mode;
  end if;

  if v_gladiator.cred < v_cost then
    raise exception 'Insufficient CRED for mutation: % < %', v_gladiator.cred, v_cost;
  end if;

  select max(mutation.created_at)
  into v_last_mutation_at
  from public.gladiator_mutations mutation
  where mutation.gladiator_id = p_gladiator_id;

  if v_last_mutation_at > now() - interval '6 hours' then
    raise exception 'Mutation strain is still active. Try again at %', v_last_mutation_at + interval '6 hours';
  end if;

  v_old_value := greatest(1, least(100, coalesce(nullif(v_gladiator.stats->>p_stat_key, '')::integer, 50)));

  if p_mutation_mode = 'graft' and v_old_value >= 100 then
    raise exception 'Selected stat is already perfected';
  end if;

  if p_mutation_mode = 'graft' then
    v_new_value := least(100, v_old_value + 3);
  else
    v_delta := floor(random() * 21)::integer - 8;
    if v_delta = 0 then
      v_delta := 1;
    end if;
    v_new_value := greatest(1, least(100, v_old_value + v_delta));
  end if;

  if v_new_value = v_old_value then
    if v_new_value >= 100 then
      v_new_value := 99;
    else
      v_new_value := v_new_value + 1;
    end if;
  end if;

  v_stats := jsonb_set(coalesce(v_gladiator.stats, '{}'::jsonb), array[p_stat_key], to_jsonb(v_new_value));
  v_cred_remaining := v_gladiator.cred - v_cost;

  update public.gladiators
  set
    stats = v_stats,
    cred = v_cred_remaining
  where id = p_gladiator_id;

  insert into public.gladiator_mutations (
    gladiator_id, user_id, stat_key, mutation_mode, old_value, new_value, cred_cost
  ) values (
    p_gladiator_id, v_user_id, p_stat_key, p_mutation_mode, v_old_value, v_new_value, v_cost
  )
  returning id, created_at into v_mutation_id, v_mutated_at;

  return jsonb_build_object(
    'mutation_id', v_mutation_id,
    'gladiator_id', p_gladiator_id,
    'stat_key', p_stat_key,
    'mutation_mode', p_mutation_mode,
    'old_value', v_old_value,
    'new_value', v_new_value,
    'cred_spent', v_cost,
    'cred_remaining', v_cred_remaining,
    'next_mutation_at', v_mutated_at + interval '6 hours',
    'stats', v_stats
  );
end;
$$;

revoke all on function public.mutate_colosseum_gladiator(text, text, text) from public, anon, authenticated;
grant execute on function public.mutate_colosseum_gladiator(text, text, text) to authenticated;

comment on function public.mutate_colosseum_gladiator(text, text, text) is
  'Permanently mutates a single gladiator stat using CRED, with ownership, active-match, cooldown, and CRED checks enforced server-side.';

-- Mutation Forge changes are public to enable Mutation Scars in gladiator inspection.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gladiator_mutations'
  ) then
    alter publication supabase_realtime add table public.gladiator_mutations;
  end if;
end
$$;

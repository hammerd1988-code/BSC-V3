alter table public.matches
  add column if not exists arena_modifier text check (
    arena_modifier in ('no_regex', 'linear_time', 'pure_function', 'memory_lock', 'token_tax')
  ),
  add column if not exists arena_modifier_draw bigint;

grant insert (arena_modifier, arena_modifier_draw) on public.matches to authenticated;

create or replace function public.colosseum_arena_modifier_card(p_code text)
returns table (
  code text,
  label text,
  description text,
  rule_text text,
  risk_multiplier numeric
)
language sql
immutable
security definer
set search_path = ''
as $$
  select cards.code, cards.label, cards.description, cards.rule_text, cards.risk_multiplier
  from (
    values
      (
        'no_regex',
        'Null Pattern',
        'The arena burns every regular expression on entry.',
        'Do not use regular expressions or RegExp APIs. Solve with explicit parsing.',
        1.15::numeric
      ),
      (
        'linear_time',
        'Redline Clock',
        'Anything slower than a single linear pass bleeds points.',
        'The solution must run in O(n) time relative to its primary input.',
        1.25::numeric
      ),
      (
        'pure_function',
        'Clean Hands',
        'Mutation is forbidden. Inputs must leave the pit untouched.',
        'Use a pure function: do not mutate inputs, globals, or shared state.',
        1.20::numeric
      ),
      (
        'memory_lock',
        'Iron Memory Lock',
        'The heap is rationed and waste is punished.',
        'Use O(1) auxiliary space unless the output itself requires additional storage.',
        1.30::numeric
      ),
      (
        'token_tax',
        'Hundred-Token Tax',
        'Every unnecessary symbol feeds the house.',
        'Keep the implementation concise: no more than 12 non-empty lines, without sacrificing readability.',
        1.20::numeric
      )
  ) as cards(code, label, description, rule_text, risk_multiplier)
  where cards.code = p_code;
$$;

revoke all on function public.colosseum_arena_modifier_card(text) from public, anon, authenticated;

create or replace function public.draw_colosseum_arena_modifier(
  p_challenger_id text,
  p_defender_id text,
  p_challenge_type text
)
returns table (
  code text,
  label text,
  description text,
  rule_text text,
  risk_multiplier numeric,
  draw_window bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_draw_window bigint := floor(extract(epoch from now()) / 900)::bigint;
  v_index integer;
  v_code text;
begin
  if p_challenger_id = p_defender_id
    or p_challenge_type not in ('speed_round', 'debug_battle', 'code_golf')
  then
    raise exception 'Invalid arena modifier draw';
  end if;

  if not exists (
    select 1
    from public.gladiators gladiator
    join public.users arena_user on arena_user.id = gladiator.user_id
    where gladiator.id = p_challenger_id
      and arena_user.auth_uid = auth.uid()
  ) then
    raise exception 'Only the gladiator owner can draw an arena condition';
  end if;
  if not exists (
    select 1 from public.gladiators where id = p_defender_id
  ) then
    raise exception 'Arena opponent not found';
  end if;

  v_index := mod(mod(
    hashtextextended(
      concat_ws(':', p_challenger_id, p_defender_id, p_challenge_type, v_draw_window::text),
      0
    ),
    5
  ) + 5, 5)::integer;
  v_code := (array['no_regex', 'linear_time', 'pure_function', 'memory_lock', 'token_tax'])[v_index + 1];

  return query
  select card.code, card.label, card.description, card.rule_text, card.risk_multiplier, v_draw_window
  from public.colosseum_arena_modifier_card(v_code) card;
end;
$$;

revoke all on function public.draw_colosseum_arena_modifier(text, text, text) from public, anon;
grant execute on function public.draw_colosseum_arena_modifier(text, text, text) to authenticated;

create or replace function public.seal_colosseum_arena_modifier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_window bigint := floor(extract(epoch from now()) / 900)::bigint;
  v_expected_code text;
  v_card record;
  v_base_prompt text;
begin
  if tg_op = 'UPDATE'
    and (
      new.arena_modifier is distinct from old.arena_modifier
      or new.arena_modifier_draw is distinct from old.arena_modifier_draw
    )
  then
    raise exception 'Arena condition seal is immutable';
  end if;

  if new.arena_modifier is null then
    new.arena_modifier_draw := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_base_prompt := coalesce(
      old.replay_data->>'arena_base_prompt',
      old.replay_data->>'challenge_prompt',
      new.replay_data->>'challenge_prompt',
      ''
    );
  else
    if new.mode is distinct from 'ranked' then
      raise exception 'Arena conditions require a ranked match';
    end if;
    if new.arena_modifier_draw is null then
      raise exception 'Arena condition draw window is required';
    end if;
    if new.arena_modifier_draw not in (v_current_window, v_current_window - 1) then
      raise exception 'Arena condition draw has expired';
    end if;
    v_base_prompt := coalesce(new.replay_data->>'challenge_prompt', '');
  end if;

  v_expected_code := (array['no_regex', 'linear_time', 'pure_function', 'memory_lock', 'token_tax'])[
    mod(mod(
      hashtextextended(
        concat_ws(
          ':',
          new.challenger_id,
          new.defender_id,
          new.challenge_type,
          new.arena_modifier_draw::text
        ),
        0
      ),
      5
    ) + 5, 5)::integer + 1
  ];
  if new.arena_modifier is distinct from v_expected_code then
    raise exception 'Arena condition does not match the sealed draw';
  end if;

  select * into v_card
  from public.colosseum_arena_modifier_card(new.arena_modifier);
  if not found then
    raise exception 'Unknown arena condition';
  end if;

  new.replay_data := jsonb_set(
    coalesce(new.replay_data, '{}'::jsonb),
    '{arena_base_prompt}',
    to_jsonb(v_base_prompt),
    true
  );
  new.replay_data := jsonb_set(
    new.replay_data,
    '{arena_modifier}',
    jsonb_build_object(
      'code', v_card.code,
      'label', v_card.label,
      'description', v_card.description,
      'rule_text', v_card.rule_text,
      'risk_multiplier', v_card.risk_multiplier
    ),
    true
  );
  new.replay_data := jsonb_set(
    new.replay_data,
    '{challenge_prompt}',
    to_jsonb(
      v_base_prompt
      || E'\n\nARENA CONDITION — '
      || v_card.label
      || ': '
      || v_card.rule_text
    ),
    true
  );

  return new;
end;
$$;

revoke all on function public.seal_colosseum_arena_modifier() from public, anon, authenticated;

drop trigger if exists seal_colosseum_arena_modifier_before_insert on public.matches;
create trigger seal_colosseum_arena_modifier_before_insert
  before insert on public.matches
  for each row
  execute function public.seal_colosseum_arena_modifier();

drop trigger if exists seal_colosseum_arena_modifier_before_update on public.matches;
create trigger seal_colosseum_arena_modifier_before_update
  before update of replay_data, arena_modifier, arena_modifier_draw on public.matches
  for each row
  when (old.arena_modifier is not null or new.arena_modifier is not null)
  execute function public.seal_colosseum_arena_modifier();

create or replace function public.reward_colosseum_arena_modifier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card record;
  v_base_reward integer;
  v_bonus integer;
begin
  if old.completed_at is not null
    or new.completed_at is null
    or new.status is distinct from 'complete'
    or new.mode is distinct from 'ranked'
    or new.arena_modifier is null
    or new.winner_id not in (new.challenger_id, new.defender_id)
  then
    return new;
  end if;

  select * into v_card
  from public.colosseum_arena_modifier_card(new.arena_modifier);
  v_base_reward := case new.challenge_type
    when 'speed_round' then 60
    when 'debug_battle' then 80
    when 'code_golf' then 100
    else 75
  end;
  v_bonus := greatest(0, floor(v_base_reward * (v_card.risk_multiplier - 1))::integer);

  if v_bonus > 0 then
    update public.gladiators
    set cred = cred + v_bonus,
        xp = xp + (v_bonus * 2)
    where id = new.winner_id;

    update public.matches
    set replay_data = jsonb_set(
      coalesce(replay_data, '{}'::jsonb),
      '{arena_modifier_bonus_cred}',
      to_jsonb(v_bonus),
      true
    )
    where id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.reward_colosseum_arena_modifier() from public, anon, authenticated;

drop trigger if exists reward_colosseum_arena_modifier_after_update on public.matches;
create trigger reward_colosseum_arena_modifier_after_update
  after update of completed_at, status on public.matches
  for each row
  execute function public.reward_colosseum_arena_modifier();

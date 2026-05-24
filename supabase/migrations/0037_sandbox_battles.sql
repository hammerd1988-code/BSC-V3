-- Migration 0037: Sandbox Build battles
-- Adds 'sandbox_build' challenge type where gladiators build real products
-- in sandboxed environments, judged on the finished result.
-- Also adds neural_whisper column for the 1x-per-battle coaching hint.

-- Widen challenge_type constraints to include sandbox_build
alter table public.matches
  drop constraint if exists matches_challenge_type_allowed,
  add constraint matches_challenge_type_allowed check (
    challenge_type in (
      'speed_round',
      'debug_battle',
      'code_golf',
      'architect_duel',
      'prompt_war',
      'roast_battle',
      'code_jeopardy',
      'sandbox_build'
    )
  );

alter table public.tournaments
  drop constraint if exists tournaments_challenge_type_allowed,
  drop constraint if exists tournaments_challenge_type_check,
  add constraint tournaments_challenge_type_check check (
    challenge_type in (
      'speed_round',
      'debug_battle',
      'code_golf',
      'architect_duel',
      'prompt_war',
      'roast_battle',
      'code_jeopardy',
      'sandbox_build'
    )
  );

alter table public.battle_records
  drop constraint if exists battle_records_challenge_type_allowed,
  add constraint battle_records_challenge_type_allowed check (
    challenge_type in (
      'speed_round',
      'debug_battle',
      'code_golf',
      'architect_duel',
      'prompt_war',
      'roast_battle',
      'code_jeopardy',
      'sandbox_build'
    )
  );

-- Neural Whisper: each match can store one whisper per side
alter table public.matches
  add column if not exists challenger_whisper text,
  add column if not exists defender_whisper text;

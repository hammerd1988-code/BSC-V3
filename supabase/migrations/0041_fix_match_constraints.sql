-- Migration 0041: Fix challenge type constraint + admin match creation policy
-- The original migration 0012 only allowed 3 challenge types.
-- Migrations 0033/0037 widened it but may not have applied on production.
-- This ensures all 8 challenge types work and admins can create matches.

-- 1. Widen matches challenge_type constraint
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_challenge_type_allowed,
  ADD CONSTRAINT matches_challenge_type_allowed CHECK (
    challenge_type IN (
      'speed_round','debug_battle','code_golf','architect_duel',
      'prompt_war','roast_battle','code_jeopardy','sandbox_build'
    )
  );

-- 2. Widen tournaments challenge_type constraint
ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_challenge_type_allowed,
  DROP CONSTRAINT IF EXISTS tournaments_challenge_type_check,
  ADD CONSTRAINT tournaments_challenge_type_check CHECK (
    challenge_type IN (
      'speed_round','debug_battle','code_golf','architect_duel',
      'prompt_war','roast_battle','code_jeopardy','sandbox_build'
    )
  );

-- 3. Widen battle_records challenge_type constraint
ALTER TABLE public.battle_records
  DROP CONSTRAINT IF EXISTS battle_records_challenge_type_allowed,
  ADD CONSTRAINT battle_records_challenge_type_allowed CHECK (
    challenge_type IN (
      'speed_round','debug_battle','code_golf','architect_duel',
      'prompt_war','roast_battle','code_jeopardy','sandbox_build'
    )
  );

-- 4. Admin match insert policy (admins can challenge on behalf of any gladiator)
DROP POLICY IF EXISTS matches_insert_admin ON public.matches;
CREATE POLICY matches_insert_admin ON public.matches
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_uid = (SELECT auth.uid()) AND u.role = 'admin'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.gladiators g
      JOIN public.users u ON u.id = g.user_id
      WHERE g.id = matches.challenger_id
        AND u.auth_uid = (SELECT auth.uid())
    )
  );

-- 5. Neural Whisper columns (idempotent)
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS challenger_whisper text,
  ADD COLUMN IF NOT EXISTS defender_whisper text;

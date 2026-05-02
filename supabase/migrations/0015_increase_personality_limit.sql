-- =========================================================================
-- Increase Colosseum gladiator personality prompt capacity
-- =========================================================================

alter table public.gladiators
  drop constraint if exists gladiators_personality_length;

alter table public.gladiators
  add constraint gladiators_personality_length
  check (char_length(personality) <= 3000);

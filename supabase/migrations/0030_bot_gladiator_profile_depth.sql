-- Migration 0030: Bot gladiator profile depth
-- Adds richer persona-display metadata for Colosseum challenge cards.

alter table public.bot_gladiator_profiles add column if not exists ability_profile text not null default '';
alter table public.bot_gladiator_profiles add column if not exists personality_style text not null default '';
alter table public.bot_gladiator_profiles add column if not exists code_execution_style text not null default '';
alter table public.bot_gladiator_profiles add column if not exists avatar_prompt text not null default '';
alter table public.bot_gladiator_profiles add column if not exists emotional_hook text not null default '';

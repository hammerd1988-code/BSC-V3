-- 0027_casper_subagents_awaiting_client.sql
--
-- Phase 10: local-LLM fan-out for sub-agents.
--
-- When the user has a local OpenAI-compatible endpoint configured
-- (LM Studio / Ollama / etc.), the server cannot reach the user's
-- machine, so sub-agent fan-out falls back to the platform default
-- LLM today (see sanitizeUserSettingsForServer in
-- casperControlCenter.ts).
--
-- This migration adds an 'awaiting_client' status so the spawn
-- endpoint can park each row server-side, return a deferred-execution
-- descriptor to the browser for each one, and the browser can then
-- run the sub-agent prompts against its localhost LLM in parallel
-- and POST the result back per-row. Status flow:
--
--   queued -> working -> completed
--                     -> failed
--
--   queued -> awaiting_client -> completed
--                             -> failed
--
-- Server-side fan-out keeps the existing 3-state path; only local-LLM
-- fan-out introduces 'awaiting_client'.

alter table public.casper_subagents
  drop constraint if exists casper_subagents_status_check;

alter table public.casper_subagents
  add constraint casper_subagents_status_check
  check (status in ('queued','working','awaiting_client','completed','failed'));

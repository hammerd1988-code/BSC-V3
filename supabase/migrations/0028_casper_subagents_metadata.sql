-- Add a JSONB metadata column to casper_subagents so sub-agents with
-- tool-calling enabled can persist their tool call audit trail
-- (tool_calls, tool_call_count) alongside the text result.
-- Idempotent: safe to re-run.

alter table public.casper_subagents
  add column if not exists metadata jsonb;

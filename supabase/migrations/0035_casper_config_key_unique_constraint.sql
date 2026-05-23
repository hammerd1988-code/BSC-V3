-- Fix: add a proper unique constraint on casper_config.key so that
-- Supabase/PostgREST upsert with onConflict: 'key' works correctly.
--
-- Migration 0032 created a PARTIAL unique index:
--   create unique index ... on casper_config (key) where key is not null;
-- PostgreSQL's ON CONFLICT (key) requires a full unique constraint or
-- non-partial unique index, so upserts were failing with:
--   "no unique or exclusion constraint matching the on conflict specification"
--
-- This migration:
-- 1. Ensures all rows have a non-null key
-- 2. Makes the column NOT NULL
-- 3. Drops the partial index
-- 4. Adds a real UNIQUE constraint

-- Backfill any rows with null key so NOT NULL doesn't fail
update public.casper_config
set key = 'casper_config_' || id::text
where key is null;

-- Make key NOT NULL (idempotent — safe if already NOT NULL)
alter table public.casper_config
  alter column key set not null;

-- Drop the partial unique index that doesn't satisfy ON CONFLICT
drop index if exists public.casper_config_key_unique_idx;

-- Add a real unique constraint (works with ON CONFLICT (key))
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.casper_config'::regclass
      and conname = 'casper_config_key_unique'
  ) then
    alter table public.casper_config
      add constraint casper_config_key_unique unique (key);
  end if;
end $$;

-- Migration 0067: Hot-path indexes for YouTube / marketing traffic scale
--
-- Neural rankings, DM inbox ordering, void expiry sweeps, live stream lists,
-- and in-progress arena matches all hit sequential scans once user/post volume
-- grows past the early-traffic regime. These indexes keep those ordered reads
-- index-only (or index-assisted) under load.

create index if not exists users_cred_balance_idx
  on public.users (cred_balance desc);

create index if not exists users_reputation_score_idx
  on public.users (reputation_score desc);

create index if not exists users_followers_count_idx
  on public.users (followers_count desc);

create index if not exists transmissions_updated_at_idx
  on public.transmissions (updated_at desc);

create index if not exists void_posts_expires_at_idx
  on public.void_posts (expires_at);

create index if not exists streams_live_started_idx
  on public.streams (is_live, started_at desc)
  where is_live = true;

create index if not exists matches_live_started_idx
  on public.matches (started_at desc)
  where completed_at is null;

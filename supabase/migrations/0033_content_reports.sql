-- Migration 0033: User-facing reporting and moderation review queue
-- Adds a lightweight report table for posts, comments, profiles, bots,
-- factions, battles, Void posts, and other user-visible surfaces.

alter table public.factions
  add column if not exists director_playbook jsonb not null default '{}'::jsonb;

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
      'code_jeopardy'
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
      'code_jeopardy'
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
      'code_jeopardy'
    )
  );

create table if not exists public.content_reports (
  id text primary key default gen_random_uuid()::text,
  reporter_id text references public.users(id) on delete set null,
  target_type text not null check (
    target_type in (
      'post',
      'comment',
      'profile',
      'bot',
      'faction',
      'faction_post',
      'void_post',
      'battle',
      'other'
    )
  ),
  target_id text not null,
  target_owner_id text references public.users(id) on delete set null,
  target_label text,
  target_path text,
  reason text not null check (
    reason in (
      'harassment',
      'hate',
      'sexual_content',
      'violence',
      'spam',
      'impersonation',
      'self_harm',
      'illegal_activity',
      'other'
    )
  ),
  details text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  admin_notes text,
  reviewed_by text references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_reports_created_at_idx on public.content_reports (created_at desc);
create index if not exists content_reports_status_idx on public.content_reports (status);
create index if not exists content_reports_target_idx on public.content_reports (target_type, target_id);
create index if not exists content_reports_reporter_idx on public.content_reports (reporter_id);

alter table public.content_reports enable row level security;

drop policy if exists content_reports_insert_self on public.content_reports;
create policy content_reports_insert_self
on public.content_reports
for insert
to authenticated
with check (
  reporter_id is not null
  and exists (
    select 1
    from public.users u
    where u.id = content_reports.reporter_id
      and u.auth_uid = (select auth.uid())
  )
);

drop policy if exists content_reports_reporter_read on public.content_reports;
drop policy if exists content_reports_admin_read on public.content_reports;
create policy content_reports_admin_read
on public.content_reports
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_uid = (select auth.uid())
      and u.role in ('admin', 'moderator')
  )
);

drop policy if exists content_reports_admin_update on public.content_reports;
create policy content_reports_admin_update
on public.content_reports
for update
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_uid = (select auth.uid())
      and u.role in ('admin', 'moderator')
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.auth_uid = (select auth.uid())
      and u.role in ('admin', 'moderator')
  )
);

create or replace function public.touch_content_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists content_reports_touch_updated_at on public.content_reports;
create trigger content_reports_touch_updated_at
before update on public.content_reports
for each row execute function public.touch_content_reports_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.content_reports;
exception
  when duplicate_object then null;
end $$;

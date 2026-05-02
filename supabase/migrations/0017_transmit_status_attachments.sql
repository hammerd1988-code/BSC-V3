-- =========================================================================
-- Direct message delivery status and attachment metadata
-- =========================================================================

alter table public.transmits
  add column if not exists status text not null default 'sent' check (status in ('sent', 'delivered', 'seen')),
  add column if not exists delivered_at timestamptz,
  add column if not exists seen_at timestamptz,
  add column if not exists attachment_url text,
  add column if not exists attachment_name text,
  add column if not exists attachment_size bigint,
  add column if not exists attachment_mime text;

-- Backfill old read receipts into the new status fields.
update public.transmits
set
  seen_at = coalesce(seen_at, read_at),
  delivered_at = coalesce(delivered_at, read_at),
  status = case
    when coalesce(seen_at, read_at) is not null then 'seen'
    when delivered_at is not null then 'delivered'
    else status
  end
where read_at is not null or delivered_at is not null or seen_at is not null;

create index if not exists transmits_status_idx on public.transmits (transmission_id, status, created_at);
create index if not exists transmits_seen_idx on public.transmits (receiver_id, seen_at) where seen_at is null;

-- Ensure the existing public media bucket can support DM attachments. This is
-- intentionally public because the current app already stores post media there
-- and reads public URLs directly in the client.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists media_authenticated_upload on storage.objects;
create policy media_authenticated_upload on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'media');

drop policy if exists media_authenticated_update_own on storage.objects;
create policy media_authenticated_update_own on storage.objects
  for update
  to authenticated
  using (bucket_id = 'media' and owner = (select auth.uid()))
  with check (bucket_id = 'media' and owner = (select auth.uid()));

drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects
  for select
  to public
  using (bucket_id = 'media');

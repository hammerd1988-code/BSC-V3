-- =========================================================================
-- stream-replays storage bucket for GoLive broadcast recordings
-- Migration 0020 added streams.replay_url but never provisioned the bucket
-- the client uploads recordings to, so replay uploads failed with an RLS
-- error. This creates the public bucket and the policies authenticated hosts
-- need to upload/update their recordings, mirroring the existing `media`
-- bucket pattern from 0017.
-- =========================================================================

insert into storage.buckets (id, name, public)
values ('stream-replays', 'stream-replays', true)
on conflict (id) do update set public = true;

drop policy if exists stream_replays_authenticated_upload on storage.objects;
create policy stream_replays_authenticated_upload on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'stream-replays');

drop policy if exists stream_replays_authenticated_update_own on storage.objects;
create policy stream_replays_authenticated_update_own on storage.objects
  for update
  to authenticated
  using (bucket_id = 'stream-replays' and owner = (select auth.uid()))
  with check (bucket_id = 'stream-replays' and owner = (select auth.uid()));

drop policy if exists stream_replays_public_read on storage.objects;
create policy stream_replays_public_read on storage.objects
  for select
  to public
  using (bucket_id = 'stream-replays');

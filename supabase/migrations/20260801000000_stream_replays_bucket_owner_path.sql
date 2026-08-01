-- =========================================================================
-- Tighten stream-replays upload policy to the uploader's own folder.
-- The initial policy (20260717000000_stream_replays_bucket.sql) only checked
-- bucket_id, so any authenticated user could write objects under any other
-- user's folder prefix (e.g. `<victim-uuid>/...`) in this public-read bucket.
-- The client uploads to `<auth.uid()>/<stream-id>-<ts>.webm`, so constrain the
-- first path segment to the uploader's id, mirroring per-user storage policies.
-- =========================================================================

drop policy if exists stream_replays_authenticated_upload on storage.objects;
create policy stream_replays_authenticated_upload on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'stream-replays'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists stream_replays_authenticated_update_own on storage.objects;
create policy stream_replays_authenticated_update_own on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'stream-replays'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'stream-replays'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Migration 0002: Security fixes and storage bucket setup
-- Applied: 2026-04-17
-- Purpose: Fix apply_increments search_path warning and provision media storage bucket

-- ============================================================================
-- 1. SECURITY FIX: Set immutable search_path for apply_increments function
-- ============================================================================
create or replace function public.apply_increments(
    p_table text,
    p_id    text,
    p_delta jsonb   -- {"likes": 1, "boosts": -2}
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    col text;
    val numeric;
    sets text := '';
begin
    for col, val in select key, (value::text)::numeric from jsonb_each_text(p_delta) loop
        sets := sets || format('%I = coalesce(%I,0) + %L, ', col, col, val);
    end loop;

    if length(sets) = 0 then
        return;
    end if;

    execute format(
        'update public.%I set %s updated_at = now() where id = %L',
        p_table, rtrim(sets, ', '), p_id
    );
end;
$$;

-- ============================================================================
-- 2. STORAGE: Create media bucket for user uploads
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  52428800, -- 50MB limit
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav']
)
on conflict (id) do nothing;

-- ============================================================================
-- 3. STORAGE RLS: Policies for the media bucket
-- ============================================================================
-- NOTE: Public buckets serve files via direct public URLs (no SELECT policy
-- needed). We intentionally do NOT create a broad SELECT policy because that
-- would allow clients to LIST every object in the bucket.

-- Authenticated users can upload
create policy "Authenticated users can upload media"
on storage.objects for insert
to authenticated
with check (bucket_id = 'media');

-- Users can update their own uploads (folder = user id)
create policy "Users can update own media"
on storage.objects for update
to authenticated
using (bucket_id = 'media' and auth.uid()::text = (storage.foldername(name))[1]);

-- Users can delete their own uploads
create policy "Users can delete own media"
on storage.objects for delete
to authenticated
using (bucket_id = 'media' and auth.uid()::text = (storage.foldername(name))[1]);

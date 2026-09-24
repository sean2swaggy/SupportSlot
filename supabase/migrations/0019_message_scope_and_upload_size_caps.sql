-- Support Slot — two smaller hardening items from the same audit pass as
-- 0018:
--
-- 1. message_threads: the only real creation path in the app
--    (startAvailabilityRequestQuestion in src/lib/queries.ts) always scopes
--    a new thread to an artist who is a genuine recipient of that
--    promoter's own availability request. The RLS insert policy was wider
--    than that: `artist_id = auth.uid() or promoter_id = auth.uid()` let
--    either side name ANY other user as the counterparty, with no
--    relationship required — so a direct client call (bypassing the app's
--    UI) could open a thread with, and message, a total stranger. It also
--    didn't check promoter_blocks, so the existing "block this promoter"
--    feature could be bypassed by direct messaging even though it was
--    built specifically to stop that promoter from reaching the artist
--    again.
--
-- 2. image_url-style columns store a resized data: URL directly (the
--    planned migration to real Supabase Storage uploads was never
--    finished — see AvatarUploadField.tsx / ImageUploadField.tsx). Client-
--    side code caps the source file at 15MB and resizes/compresses it, but
--    nothing stops a direct client call from writing an arbitrarily large
--    string into these public, publicly-readable rows. These caps are a
--    generous ceiling (comfortably above what the client's own resizing
--    ever produces) meant only to bound the resource-abuse case, not a
--    real substitute for moving these to real file storage.

drop policy "message_threads: insert participant" on public.message_threads;
create policy "message_threads: insert participant" on public.message_threads
  for insert with check (
    (artist_id = auth.uid() or promoter_id = auth.uid())
    and exists (
      select 1
      from public.availability_request_recipients r
      join public.availability_requests req on req.id = r.request_id
      where r.artist_id = message_threads.artist_id
        and req.promoter_id = message_threads.promoter_id
    )
    and not exists (
      select 1 from public.promoter_blocks b
      where b.artist_id = message_threads.artist_id and b.promoter_id = message_threads.promoter_id
    )
  );

alter table public.artists
  add constraint artists_image_url_size check (length(image_url) < 2000000),
  add constraint artists_banner_image_url_size check (length(banner_image_url) < 2000000),
  add constraint artists_live_video_thumbnail_url_size check (length(live_video_thumbnail_url) < 2000000);

alter table public.artist_tracks
  add constraint artist_tracks_cover_image_url_size check (length(cover_image_url) < 2000000);

alter table public.promoters
  add constraint promoters_avatar_url_size check (length(avatar_url) < 2000000);

alter table public.slots
  add constraint slots_headliner_image_url_size check (length(headliner_image_url) < 2000000),
  add constraint slots_artist_photo_url_size check (length(artist_photo_url) < 2000000);

-- ---------------------------------------------------------------------------
-- 3. Belt-and-braces DB-level backstop for the stored-XSS fix in
--    src/lib/artist-links.ts (isSafeExternalUrl). The real fix is at the
--    render layer (any non-http(s) value, e.g. `javascript:...`, is now
--    dropped before it's ever put in an href) since that protects existing
--    rows too without needing this migration applied first — this
--    constraint just stops a bad value from being written at all, as a
--    second layer.
-- ---------------------------------------------------------------------------
alter table public.artists
  add constraint artists_spotify_url_scheme check (spotify_url = '' or spotify_url ~ '^https?://'),
  add constraint artists_instagram_url_scheme check (instagram_url = '' or instagram_url ~ '^https?://'),
  add constraint artists_tiktok_url_scheme check (tiktok_url = '' or tiktok_url ~ '^https?://'),
  add constraint artists_soundcloud_url_scheme check (soundcloud_url is null or soundcloud_url ~ '^https?://'),
  add constraint artists_bandcamp_url_scheme check (bandcamp_url is null or bandcamp_url ~ '^https?://'),
  add constraint artists_youtube_url_scheme check (youtube_url is null or youtube_url ~ '^https?://'),
  add constraint artists_website_url_scheme check (website_url is null or website_url ~ '^https?://'),
  add constraint artists_live_video_url_scheme check (live_video_url is null or live_video_url ~ '^https?://');

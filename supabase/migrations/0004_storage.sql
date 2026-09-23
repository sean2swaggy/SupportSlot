-- Support Slot — Storage buckets for real image uploads (avatars, slot
-- images, artist reference photos), replacing the old data-URL-in-
-- localStorage approach. Public read (images are shown on public pages),
-- write restricted to files under the uploader's own auth.uid() folder.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('slot-images', 'slot-images', true)
on conflict (id) do nothing;

create policy "avatars: public read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars: write own folder" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "avatars: update own folder" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "avatars: delete own folder" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "slot-images: public read" on storage.objects
  for select using (bucket_id = 'slot-images');
create policy "slot-images: write own folder" on storage.objects
  for insert with check (
    bucket_id = 'slot-images' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "slot-images: update own folder" on storage.objects
  for update using (
    bucket_id = 'slot-images' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "slot-images: delete own folder" on storage.objects
  for delete using (
    bucket_id = 'slot-images' and (storage.foldername(name))[1] = auth.uid()::text
  );

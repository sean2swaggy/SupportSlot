-- Support Slot — seed the 6 curated venues (matches src/lib/mock-data.ts
-- VENUES exactly, same ids). This is reference data for the create-slot
-- venue picker, not user-generated marketplace content — see plan notes.
-- Run once via the Supabase SQL editor (service role / project owner).

insert into public.venues (id, name, city, capacity, address, image_url, verification) values
  ('venue-1', 'Village Underground', 'London', 780, '54 Holywell Ln, London EC2A 3PQ', 'https://picsum.photos/seed/ss-venue-london-1/1200/800', 'verified'),
  ('venue-2', 'YES Basement', 'Manchester', 350, '38 Charles St, Manchester M1 6EU', 'https://picsum.photos/seed/ss-venue-manchester-1/1200/800', 'verified'),
  ('venue-3', 'Strange Brew', 'Bristol', 250, '23-25 St Nicholas St, Bristol BS1 1TP', 'https://picsum.photos/seed/ss-venue-bristol-1/1200/800', 'verified'),
  ('venue-4', 'The Snug', 'Birmingham', 180, 'Kings Heath High St, Birmingham B14', 'https://picsum.photos/seed/ss-venue-birmingham-1/1200/800', 'unverified'),
  ('venue-5', 'The Warehouse Exchange', 'Leeds', 420, 'Mabgate Mills, Leeds LS9', 'https://picsum.photos/seed/ss-venue-leeds-1/1200/800', 'verified'),
  ('venue-6', 'The Arch Room', 'Brighton', 300, 'Kings Rd Arches, Brighton BN1', 'https://picsum.photos/seed/ss-venue-brighton-1/1200/800', 'verified')
on conflict (id) do nothing;

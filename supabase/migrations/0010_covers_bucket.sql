-- Public bucket for real generated cover images (previously the Cover
-- Department only produced text prompts, never actual artwork). Public
-- read for the same reason as avatars — needs to render as a plain
-- <img src> without signed-URL ceremony, and a book cover isn't sensitive
-- content. Only the server (service-role client, from the Cover
-- Department's background tick) ever writes here — no client-side
-- insert/update/delete policy is needed, matching how the private
-- `exports` bucket is server-write-only too.
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

drop policy if exists "covers: public read" on storage.objects;
create policy "covers: public read" on storage.objects
  for select using (bucket_id = 'covers');

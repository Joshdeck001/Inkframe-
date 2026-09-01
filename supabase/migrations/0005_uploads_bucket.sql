-- InkFrame — private bucket for user-supplied manuscripts (Translation
-- Department's "upload a manuscript" path). Unlike `exports`, the browser
-- uploads directly here (as the signed-in user, via the anon key), so it
-- needs real storage.objects RLS rather than service-role-only access.
-- Files are stored under `{user_id}/...` — policies key off that prefix.

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

create policy "uploads: owner can insert own files" on storage.objects
  for insert
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads: owner can read own files" on storage.objects
  for select
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads: owner can delete own files" on storage.objects
  for delete
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

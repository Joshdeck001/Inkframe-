-- InkFrame — storage bucket for generated export files (DOCX/EPUB/PDF).
-- Private bucket: all access goes through server routes using the
-- service-role client (which generates short-lived signed URLs), never
-- direct client reads, so no storage.objects RLS policy is needed here.

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

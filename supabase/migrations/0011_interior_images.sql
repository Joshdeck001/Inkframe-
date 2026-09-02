-- Interior/in-manuscript images (Image Department) — a separate, later
-- feature from cover art. `image_placements` already existed in the
-- original schema (Step 6) anticipating this, unused until now.

-- New pipeline stage between cover art and metadata, same shape as every
-- other department's status handoff. Postgres auto-names an inline
-- `check (...)` constraint `<table>_<column>_check`.
alter table public.projects drop constraint projects_status_check;
alter table public.projects add constraint projects_status_check check (status in (
  'IDEA','BLUEPRINT','AWAITING_APPROVAL','QUEUED','WRITING','RESEARCHING',
  'REVIEWING','REVISING','FORMATTING','GENERATING_COVER','GENERATING_IMAGES','GENERATING_METADATA',
  'COMPLIANCE_CHECK','READY_FOR_REVIEW','USER_APPROVED','READY_FOR_EXPORT','EXPORTED',
  'AWAITING_CONTRACT_DECISION','CONTRACT_RECEIVED','CONTRACT_NOT_ACCEPTED','REVISION_REQUESTED'
));

-- Bookkeeping so a permanently-unavailable image provider doesn't get
-- retried every tick forever — same bounded-retry pattern as
-- cover_department.concepts' image_attempted (there it's a jsonb field
-- since concepts is jsonb; here it's a real column since image_placements
-- is a real table).
alter table public.image_placements add column if not exists image_attempted boolean not null default false;

-- chapter_id was declared without a foreign key in the original schema.
-- Adding one now that it's actually populated (by the Image Department)
-- lets the UI embed chapter_number/title in one query, and keeps a
-- deleted chapter from leaving a dangling reference.
alter table public.image_placements
  add constraint image_placements_chapter_id_fkey foreign key (chapter_id) references public.chapters(id) on delete set null;

-- Public bucket for real generated interior artwork, same pattern as
-- `covers` (0010): public read so it renders as a plain <img src>, server
-- (service-role client) is the only writer.
insert into storage.buckets (id, name, public)
values ('manuscript-images', 'manuscript-images', true)
on conflict (id) do nothing;

drop policy if exists "manuscript-images: public read" on storage.objects;
create policy "manuscript-images: public read" on storage.objects
  for select using (bucket_id = 'manuscript-images');

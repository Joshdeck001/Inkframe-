-- Document Structure architecture fix (formatter root-cause fix, not a
-- one-manuscript patch). Root cause: every row in `chapters` has always
-- been treated as a numbered chapter, with no way to represent front
-- matter, an introduction, or a conclusion as anything other than "a
-- chapter that happens to occupy a chapter_number." See lib/document-
-- model.ts for the single shared classifier/normalizer/validator this
-- column feeds — used identically by manuscript import, the AI
-- blueprint, legacy backfill during Reformat, DOCX, EPUB, and Book
-- Health, per the project's own "one document model" requirement.
--
-- Existing rows get section_type = NULL, not a guessed value — NULL is
-- the honest "not yet classified" state; lib/document-model.ts treats
-- NULL explicitly, never silently assumes NULL means "chapter forever."
-- Classification only happens when a project is actually reformatted
-- (or next formatted), and low-confidence guesses are flagged for
-- review rather than trusted silently — see needs_classification_review.
alter table public.chapters add column if not exists section_type text
  check (section_type in ('front_matter', 'introduction', 'chapter', 'conclusion', 'back_matter'));
alter table public.chapters add column if not exists section_type_confidence text
  check (section_type_confidence in ('high', 'medium', 'low'));
alter table public.chapters add column if not exists needs_classification_review boolean not null default false;

-- Real, optional metadata InkFrame previously had nowhere to store —
-- [PUBLISHER / IMPRINT] and [ISBN] were unconditional literal strings in
-- both exporters specifically because no field existed to hold a real
-- value (confirmed: not a "leave it blank on purpose" bug, a missing
-- column). Nullable and never fabricated — Book Health reports "Not
-- provided" honestly rather than InkFrame inventing a value.
alter table public.project_identity add column if not exists publisher_name text;
alter table public.project_identity add column if not exists isbn text;

-- Formatter/document-model versioning, so an existing formatted book can
-- be told apart from one built with the corrected architecture, and
-- Reformat can detect "this needs rebuilding" instead of guessing.
alter table public.formatting_jobs add column if not exists formatter_version text;
alter table public.formatting_jobs add column if not exists document_model_version integer;
alter table public.formatting_jobs add column if not exists source_content_hash text;

-- A structural-validation failure (e.g. a real duplicate conclusion found
-- in the source content, flagged rather than silently resolved) is
-- recoverable/reviewable, not a hard crash — distinct from 'failed'.
alter table public.formatting_jobs drop constraint if exists formatting_jobs_status_check;
alter table public.formatting_jobs add constraint formatting_jobs_status_check
  check (status in ('pending', 'processing', 'complete', 'needs_attention', 'failed'));

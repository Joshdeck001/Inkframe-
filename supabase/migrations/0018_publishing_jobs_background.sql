-- Upgrades publishing_jobs (already the one row-per-project-per-platform
-- publishing-preparation record, unique-constrained since 0004) into the
-- backing store for background KDP preparation — deliberately NOT a new
-- parallel job table. A book's "publishing job" for a platform has always
-- been one thing; this just makes that one thing richer: a resumable,
-- multi-stage background run instead of a synchronous client-side fetch.
--
-- New status values sit alongside the original four (never removed, so
-- existing rows keep working) — 'preparing' now covers both 'queued' and
-- 'running' sub-states via the new `stages` column, but the two are added
-- explicitly since the background tick needs to tell "not started yet"
-- apart from "actively running" at the query level (see
-- lib/kdp-preparation-department.ts). 'needs_attention'/'failed'/
-- 'cancelled' give the background run real, honest failure states instead
-- of only ever "preparing" forever.
alter table public.publishing_jobs drop constraint if exists publishing_jobs_status_check;
alter table public.publishing_jobs add constraint publishing_jobs_status_check check (status in (
  'preparing','ready_for_review','ready_to_publish','user_marked_published',
  'queued','running','needs_attention','failed','cancelled'
));

-- Which formats this run was asked to prepare (subset of ebook/paperback/
-- hardcover) — so a book that only wants a Kindle edition isn't blocked on
-- paperback-only requirements (spec: format-specific preparation).
alter table public.publishing_jobs add column if not exists requested_formats text[] not null default '{}';

-- Per-stage progress, resumable: [{key, label, status, detail}], status
-- one of pending/running/passed/blocked/failed. The background tick reads
-- this to know exactly where a run left off instead of restarting from
-- scratch on retry (spec: resumable jobs, don't regenerate completed
-- work).
alter table public.publishing_jobs add column if not exists stages jsonb not null default '[]'::jsonb;

-- Snapshot of the specific computeBookHealth() checks (and per-format
-- gaps) that were blocking the last preflight run, so /publish can show
-- "why" without recomputing on every render.
alter table public.publishing_jobs add column if not exists blockers jsonb not null default '[]'::jsonb;

-- Storage path of the generated "KDP Ready Package" zip, once built.
alter table public.publishing_jobs add column if not exists package_ref text;

alter table public.publishing_jobs add column if not exists started_at timestamptz;
-- When background preparation itself finished (distinct from
-- marked_published_at, which records the user's own later "I published
-- this" action).
alter table public.publishing_jobs add column if not exists prepared_at timestamptz;
alter table public.publishing_jobs add column if not exists error text;

-- Audiobook Studio: one audiobook_jobs row per production run (a project
-- can be re-run with a different voice later — same "not unique on
-- project_id, order by created_at desc for latest" pattern as
-- formatting_jobs), one audiobook_segments row per chapter narrated.
-- Narration only ever starts when a user explicitly requests it
-- (app/api/audiobook/start) — it is never part of the automatic
-- project-status pipeline, same as translation_jobs.

create table public.audiobook_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  voice text not null,
  status text not null default 'pending' check (status in (
    'pending', 'generating', 'ready_for_review', 'complete', 'failed'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audiobook_jobs_project_id_idx on public.audiobook_jobs(project_id);
create trigger audiobook_jobs_set_updated_at before update on public.audiobook_jobs
  for each row execute function public.set_updated_at();
alter table public.audiobook_jobs enable row level security;
create policy "audiobook_jobs: owner full access" on public.audiobook_jobs
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create or replace function public.owns_audiobook_job(jid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.audiobook_jobs aj
    where aj.id = jid and public.owns_project(aj.project_id)
  );
$$;

create table public.audiobook_segments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.audiobook_jobs(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  chapter_number int not null,
  status text not null default 'pending' check (status in (
    'pending', 'generating', 'generated', 'failed'
  )),
  audio_file_ref text,
  -- Estimated from word count (words / 150wpm), never measured from the
  -- real audio — labeled "estimate" everywhere it's shown so it's never
  -- mistaken for real playback-length data (spec: distinguish real vs.
  -- estimated data).
  duration_estimate_seconds numeric,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, chapter_id)
);
create index audiobook_segments_job_id_idx on public.audiobook_segments(job_id);
create trigger audiobook_segments_set_updated_at before update on public.audiobook_segments
  for each row execute function public.set_updated_at();
alter table public.audiobook_segments enable row level security;
create policy "audiobook_segments: owner full access" on public.audiobook_segments
  for all using (owns_audiobook_job(job_id)) with check (owns_audiobook_job(job_id));

-- Private bucket, same reasoning as `exports` (0003_storage.sql): narration
-- is generated server-side by the cron tick using the service-role client,
-- and played back through a signed-URL route, so no storage.objects RLS
-- policy is needed — nothing ever accesses it directly as the browser user.
insert into storage.buckets (id, name, public)
values ('audiobooks', 'audiobooks', false)
on conflict (id) do nothing;

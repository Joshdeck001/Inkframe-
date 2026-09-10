-- Research Sessions: the standalone, pre-project research unit the spec
-- calls for ("Research -> Approved Opportunity -> Create Book Project").
-- Every existing evidence table (competitor_research, keyword_research,
-- category_research, research_notes, research_reports) already IS the
-- single evidence/report schema — this does not replace it or add a
-- second one. It just lets those same rows optionally belong to a
-- session that doesn't have a project yet, instead of forcing every
-- research row to already belong to a book. Once a session's opportunity
-- is approved into a real project (see /api/research/create-project),
-- its rows get project_id backfilled and keep session_id for lineage —
-- so the exact same /research evidence tables and report generator that
-- already existed keep working unchanged for project-scoped research.

create table public.research_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  topic text not null default '',
  mode text not null default 'full_publishing_research' check (mode in (
    'book_opportunity', 'keyword_research', 'competition_analysis', 'market_research',
    'topic_research', 'series_research', 'metadata_research', 'trend_research',
    'full_publishing_research'
  )),
  -- What the author asked to compare against, not a claim that each was
  -- actually reached live — the general web-search layer (Brave Search,
  -- when configured) is not Amazon/Google/Kobo-specific; see
  -- lib/research-agent.ts and the root README's "Research Intelligence"
  -- section for why platform-specific verdicts are never fabricated.
  platforms text[] not null default '{amazon,google_play,kobo,web}',
  status text not null default 'queued' check (status in (
    'queued', 'running', 'completed', 'needs_attention', 'failed', 'cancelled'
  )),
  -- Resumable stage progress, same [{key,label,status,detail}] shape as
  -- publishing_jobs.stages (migration 0018) — one more consumer of the
  -- same convention, not a new one.
  stages jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index research_sessions_user_id_idx on public.research_sessions(user_id);
create trigger research_sessions_set_updated_at before update on public.research_sessions
  for each row execute function public.set_updated_at();
alter table public.research_sessions enable row level security;
create policy "research_sessions: owner full access" on public.research_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.owns_research_session(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.research_sessions rs
    where rs.id = sid and rs.user_id = auth.uid()
  );
$$;

-- Widen the evidence/report tables to optionally belong to a session
-- instead of only ever a project. Every row still belongs to exactly one
-- owner (project or session, checked below) so RLS never has to guess.

alter table public.competitor_research alter column project_id drop not null;
alter table public.competitor_research add column if not exists session_id uuid references public.research_sessions(id) on delete cascade;
alter table public.competitor_research add constraint competitor_research_owner_check check (project_id is not null or session_id is not null);
drop policy if exists "competitor_research: owner full access" on public.competitor_research;
create policy "competitor_research: owner full access" on public.competitor_research
  for all using (owns_project(project_id) or owns_research_session(session_id))
  with check (owns_project(project_id) or owns_research_session(session_id));

alter table public.keyword_research alter column project_id drop not null;
alter table public.keyword_research add column if not exists session_id uuid references public.research_sessions(id) on delete cascade;
alter table public.keyword_research add constraint keyword_research_owner_check check (project_id is not null or session_id is not null);
drop policy if exists "keyword_research: owner full access" on public.keyword_research;
create policy "keyword_research: owner full access" on public.keyword_research
  for all using (owns_project(project_id) or owns_research_session(session_id))
  with check (owns_project(project_id) or owns_research_session(session_id));

alter table public.category_research alter column project_id drop not null;
alter table public.category_research add column if not exists session_id uuid references public.research_sessions(id) on delete cascade;
alter table public.category_research add constraint category_research_owner_check check (project_id is not null or session_id is not null);
drop policy if exists "category_research: owner full access" on public.category_research;
create policy "category_research: owner full access" on public.category_research
  for all using (owns_project(project_id) or owns_research_session(session_id))
  with check (owns_project(project_id) or owns_research_session(session_id));

alter table public.research_notes alter column project_id drop not null;
alter table public.research_notes add column if not exists session_id uuid references public.research_sessions(id) on delete cascade;
alter table public.research_notes add constraint research_notes_owner_check check (project_id is not null or session_id is not null);
drop policy if exists "research_notes: owner full access" on public.research_notes;
create policy "research_notes: owner full access" on public.research_notes
  for all using (owns_project(project_id) or owns_research_session(session_id))
  with check (owns_project(project_id) or owns_research_session(session_id));

alter table public.research_reports alter column project_id drop not null;
alter table public.research_reports add column if not exists session_id uuid references public.research_sessions(id) on delete cascade;
alter table public.research_reports add constraint research_reports_owner_check check (project_id is not null or session_id is not null);
drop policy if exists "research_reports: owner full access" on public.research_reports;
create policy "research_reports: owner full access" on public.research_reports
  for all using (owns_project(project_id) or owns_research_session(session_id))
  with check (owns_project(project_id) or owns_research_session(session_id));

-- Real deterministic outputs, computed by lib/research-frequency.ts and
-- lib/research-opportunity.ts (word/phrase frequency, gap analysis,
-- opportunity scoring) — stored per session so the background job's work
-- persists and the UI never recomputes-and-forgets. Never a second
-- "readiness" concept: these numbers only ever describe research
-- evidence quality/opportunity, nothing about book/publishing readiness
-- (that stays computeBookHealth()'s job, untouched).
create table public.research_findings (
  session_id uuid primary key references public.research_sessions(id) on delete cascade,
  keyword_clusters jsonb not null default '[]'::jsonb,
  frequency jsonb not null default '{}'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  opportunity_score jsonb not null default '{}'::jsonb,
  concepts jsonb not null default '[]'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger research_findings_set_updated_at before update on public.research_findings
  for each row execute function public.set_updated_at();
alter table public.research_findings enable row level security;
create policy "research_findings: owner full access" on public.research_findings
  for all using (owns_research_session(session_id)) with check (owns_research_session(session_id));

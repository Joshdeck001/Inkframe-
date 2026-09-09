-- Evidence & Sources architecture for the Research workspace. The
-- existing research_notes/title_risk_checks were already honest (their
-- system prompt already says "from general market knowledge, not live
-- data", never claims a legal clearance) — what was missing was
-- structured, sortable, source-tagged evidence rather than freeform text.
--
-- source_type is deliberately narrow: 'user_provided' (the author typed
-- it in themselves, having actually looked at a real book/listing) or
-- 'ai_inference' (a model's synthesis/pattern-matching, never live data).
-- 'live_web' exists for when a real search API is configured
-- (lib/web-research-client.ts) but is not reachable by anything today —
-- adding it now avoids a later migration just to widen this enum.
-- confidence is a qualitative label, never a fabricated 0-100 number —
-- there is no live signal today to compute a real score from.

create table public.competitor_research (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  author text,
  platform text,
  publication_date date,
  format text,
  price numeric(10,2),
  category text,
  rating numeric(2,1),
  review_count int,
  positioning text,
  strengths text,
  weaknesses text,
  recurring_complaints text,
  recurring_praise text,
  content_gap text,
  differentiation_opportunity text,
  source_url text,
  source_type text not null default 'user_provided' check (source_type in ('user_provided', 'ai_inference', 'live_web')),
  confidence text check (confidence in ('low', 'medium', 'high', 'insufficient_data')),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index competitor_research_project_id_idx on public.competitor_research(project_id);
create trigger competitor_research_set_updated_at before update on public.competitor_research
  for each row execute function public.set_updated_at();
alter table public.competitor_research enable row level security;
create policy "competitor_research: owner full access" on public.competitor_research
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.keyword_research (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  keyword text not null,
  relevance text,
  demand_signal text,
  competition_signal text,
  commercial_intent text,
  source_url text,
  source_type text not null default 'user_provided' check (source_type in ('user_provided', 'ai_inference', 'live_web')),
  confidence text check (confidence in ('low', 'medium', 'high', 'insufficient_data')),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index keyword_research_project_id_idx on public.keyword_research(project_id);
create trigger keyword_research_set_updated_at before update on public.keyword_research
  for each row execute function public.set_updated_at();
alter table public.keyword_research enable row level security;
create policy "keyword_research: owner full access" on public.keyword_research
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.category_research (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category_name text not null,
  rationale text,
  competition_notes text,
  source_url text,
  source_type text not null default 'user_provided' check (source_type in ('user_provided', 'ai_inference', 'live_web')),
  confidence text check (confidence in ('low', 'medium', 'high', 'insufficient_data')),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index category_research_project_id_idx on public.category_research(project_id);
create trigger category_research_set_updated_at before update on public.category_research
  for each row execute function public.set_updated_at();
alter table public.category_research enable row level security;
create policy "category_research: owner full access" on public.category_research
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- overall_assessment is a qualitative label the model must justify in
-- sections.recommendation, never a bare number — see lib/research-report.ts.
create table public.research_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sections jsonb not null default '{}'::jsonb,
  overall_assessment text check (overall_assessment in (
    'very_promising', 'promising', 'moderate', 'high_competition', 'difficult', 'insufficient_data'
  )),
  confidence_level text check (confidence_level in ('low', 'medium', 'high', 'insufficient_data')),
  evidence_summary text,
  status text not null default 'draft' check (status in ('draft', 'accepted', 'rejected', 'needs_more_research')),
  created_at timestamptz not null default now()
);
create index research_reports_project_id_idx on public.research_reports(project_id);
alter table public.research_reports enable row level security;
create policy "research_reports: owner full access" on public.research_reports
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- Retroactively tags the already-honest existing research_notes rows
-- (the AI-generated category/title-risk notes) rather than leaving them
-- untyped now that every other research artifact carries this field.
alter table public.research_notes add column if not exists source_type text
  not null default 'ai_inference' check (source_type in ('user_provided', 'ai_inference', 'live_web'));
alter table public.research_notes add column if not exists confidence text
  check (confidence in ('low', 'medium', 'high', 'insufficient_data'));

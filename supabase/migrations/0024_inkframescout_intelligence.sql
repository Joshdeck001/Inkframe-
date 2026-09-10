-- InkframeScout "Intelligence 2.0": Competition Sets, Watchlists, and the
-- Opportunity Workspace, all built on the existing single-click capture
-- flow from 0022/0023 — still no automated/background scanning, still no
-- overlay injected into marketplace pages. See "InkframeScout Intelligence
-- 2.0" in the root README.md for what was declined from this spec and why
-- (automatic per-page detection, a fabricated sales-estimation formula,
-- and scoring dimensions — Demand, Discoverability — this app has no real
-- data to back).

-- BSR/category rank and publication date are read the same way ISBN
-- already is (extract.js, same click, same read-only rule) — genuinely
-- visible page text, not a new collection mechanism. extension_version/
-- adapter_version let every stored observation carry the exact collector
-- version that produced it (spec section 32, "Versioning").
alter table public.scout_clips add column bsr int;
alter table public.scout_clips add column category_rank int;
alter table public.scout_clips add column published_date text;
alter table public.scout_clips add column extension_version text;
alter table public.scout_clips add column adapter_version text;

-- A connection can be paused without being revoked — the extension keeps
-- its credential but the server rejects new observations until resumed
-- (spec section 5/28's "pause collection", distinct from "disconnect").
alter table public.extension_connections add column paused boolean not null default false;

create table public.competition_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);
create index competition_sets_user_id_idx on public.competition_sets(user_id);
alter table public.competition_sets enable row level security;
create policy "competition_sets: owner full access" on public.competition_sets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.owns_competition_set(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.competition_sets cs where cs.id = cid and cs.user_id = auth.uid());
$$;

-- A clip can belong to more than one competition set; membership only,
-- no data duplicated off scout_clips.
create table public.competition_set_clips (
  competition_set_id uuid not null references public.competition_sets(id) on delete cascade,
  clip_id uuid not null references public.scout_clips(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (competition_set_id, clip_id)
);
alter table public.competition_set_clips enable row level security;
create policy "competition_set_clips: owner full access" on public.competition_set_clips
  for all using (owns_competition_set(competition_set_id)) with check (owns_competition_set(competition_set_id));

-- A "watch" is just a canonical-book bookmark the user asked InkFrame to
-- keep an eye on for them. It is NOT a background poller: new
-- observations only ever arrive when the user clips that book again
-- themselves (see lib/scout-matching.ts) — the watchlist just makes it
-- easy to find which books to re-check and shows what's already known.
create table public.watched_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  isbn text,
  marketplace text,
  external_id text,
  title text,
  author text,
  created_at timestamptz not null default now(),
  constraint watched_books_identity_check check (isbn is not null or (marketplace is not null and external_id is not null))
);
create index watched_books_user_id_idx on public.watched_books(user_id);
alter table public.watched_books enable row level security;
create policy "watched_books: owner full access" on public.watched_books
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Opportunity Workspace (spec section 38). score/signals are computed by
-- lib/scout-opportunity.ts from real collected clips only — never an
-- AI-invented number — and carry a calculation_version so a later change
-- to the formula never silently reinterprets an old score (spec section
-- 23/32, "scores must be versioned"). potential_audience/positioning/
-- differentiation come from lib/scout-differentiation.ts, an AI-generated
-- (never verbatim-copied) set of directions — always additive brainstorm,
-- never a title/cover clone. Only 'approved' may become a project, and
-- only via the user's own explicit action, never automatically.
create table public.scout_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  market text,
  competition_set_id uuid references public.competition_sets(id) on delete set null,
  session_id uuid references public.research_sessions(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  evidence jsonb not null default '[]'::jsonb,
  signals jsonb not null default '[]'::jsonb,
  score jsonb,
  potential_audience text,
  potential_positioning text,
  potential_differentiation text,
  risks text,
  next_action text,
  status text not null default 'new' check (status in (
    'new', 'reviewing', 'researching', 'approved', 'rejected', 'converted_to_project'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scout_opportunities_user_id_idx on public.scout_opportunities(user_id);
create trigger scout_opportunities_set_updated_at before update on public.scout_opportunities
  for each row execute function public.set_updated_at();
alter table public.scout_opportunities enable row level security;
create policy "scout_opportunities: owner full access" on public.scout_opportunities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.owns_scout_opportunity(oid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.scout_opportunities so where so.id = oid and so.user_id = auth.uid());
$$;

-- Notes (spec section 37, "allow notes everywhere") reuse the exact same
-- research_notes table every other research path already writes to —
-- widened the same way 0019 widened it for sessions, not a second notes
-- system. A note attached this way is always source_type 'user_provided'
-- (already an allowed value) — the spec is explicit that AI may read
-- these notes as input but must never relabel them as anything else.
alter table public.research_notes add column if not exists opportunity_id uuid references public.scout_opportunities(id) on delete cascade;
alter table public.research_notes add column if not exists competition_set_id uuid references public.competition_sets(id) on delete cascade;
alter table public.research_notes drop constraint if exists research_notes_owner_check;
alter table public.research_notes add constraint research_notes_owner_check
  check (project_id is not null or session_id is not null or opportunity_id is not null or competition_set_id is not null);
drop policy if exists "research_notes: owner full access" on public.research_notes;
create policy "research_notes: owner full access" on public.research_notes
  for all using (owns_project(project_id) or owns_research_session(session_id) or owns_scout_opportunity(opportunity_id) or owns_competition_set(competition_set_id))
  with check (owns_project(project_id) or owns_research_session(session_id) or owns_scout_opportunity(opportunity_id) or owns_competition_set(competition_set_id));

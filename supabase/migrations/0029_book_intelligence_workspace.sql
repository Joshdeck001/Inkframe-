-- Book Intelligence Workspace: turns a single InkframeScout capture into
-- real analysis instead of a clip that just sits there. Extends
-- scout_opportunities (the existing "propose/approve/convert to project"
-- model, see 0024_inkframescout_intelligence.sql) rather than a new
-- parallel table, since the shape — evidence in, structured analysis out,
-- user approves, converts to a project — is the same concept, just now
-- creatable directly from ONE clip instead of only from a whole
-- competition set. Multi-book/cross-platform canonical grouping is
-- explicitly out of scope here (see lib/book-intelligence.ts) — this
-- operates on one clip's own real captured fields.

alter table public.scout_opportunities add column if not exists source_clip_id uuid references public.scout_clips(id) on delete set null;
alter table public.scout_opportunities add column if not exists book_snapshot jsonb;
alter table public.scout_opportunities add column if not exists whats_working jsonb not null default '[]'::jsonb;
alter table public.scout_opportunities add column if not exists whats_missing jsonb not null default '[]'::jsonb;
alter table public.scout_opportunities add column if not exists opportunity_ideas jsonb not null default '[]'::jsonb;
-- Each element: {..concept fields.., status: 'proposed'|'accepted'|'rejected'} — mirrors
-- research_findings.concepts' existing propose/accept-one pattern (0019_research_sessions.sql).
alter table public.scout_opportunities add column if not exists concepts jsonb not null default '[]'::jsonb;

create index if not exists scout_opportunities_source_clip_id_idx on public.scout_opportunities(source_clip_id);

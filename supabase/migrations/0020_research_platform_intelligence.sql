-- Real, evidence-gated cross-platform intelligence and keyword scoring —
-- no new evidence concept, just letting the existing rows carry a
-- platform tag (competitor_research already had one; keyword_research
-- didn't) and giving lib/research-agent.ts's analysis stage somewhere to
-- persist the deterministic per-platform/keyword/coverage computations
-- it now runs (lib/research-platforms.ts, lib/research-keywords.ts,
-- lib/research-gaps.ts's coverage matrix). All three stay real: a
-- platform only ever shows a breakdown when evidence rows are actually
-- tagged with it, never a fabricated Amazon/Google/Kobo verdict.

alter table public.keyword_research add column if not exists platform text;

alter table public.research_findings add column if not exists platform_breakdown jsonb not null default '[]'::jsonb;
alter table public.research_findings add column if not exists keyword_intelligence jsonb not null default '[]'::jsonb;
alter table public.research_findings add column if not exists coverage_matrix jsonb not null default '[]'::jsonb;

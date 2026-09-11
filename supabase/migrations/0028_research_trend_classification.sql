-- Structured trend classification (spec: "Trend Research" — EMERGING /
-- GROWING / ESTABLISHED / DECLINING / UNCLEAR / INSUFFICIENT_EVIDENCE),
-- distinct from the existing free-text trend_signals report section. Only
-- ever set for trend_research-mode sessions (see lib/research-report.ts);
-- null for every other mode and every project-scoped report (which has no
-- mode concept at all).

alter table public.research_reports add column if not exists trend_classification text
  check (trend_classification in ('EMERGING', 'GROWING', 'ESTABLISHED', 'DECLINING', 'UNCLEAR', 'INSUFFICIENT_EVIDENCE'));

-- InkframeScout v3: adds the one new real field this round's evidence
-- model needs — publisher, read the same label-scan way isbn/bsr/
-- published_date already are (extract.js, same single click, same
-- read-only rule). Everything else in v3 (Evidence Completeness,
-- Freshness, Evidence Quality, Opportunity Signals) is computed on the
-- fly from data that already exists — see lib/scout-evidence.ts and the
-- rewritten lib/scout-opportunity.ts. No schema change needed for those;
-- scout_opportunities.score is already a flexible jsonb column, so its
-- shape can move from v2's numeric dimensions to v3's qualitative
-- signals without a migration. See "InkframeScout v3" in the root
-- README.md.

alter table public.scout_clips add column publisher text;

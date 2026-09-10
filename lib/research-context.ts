import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Research -> Writing / Metadata / Cover" (spec sections 23-25) — one
 * shared lookup, not three separate integrations that could drift.
 * Approval already has a real mechanism: a research_reports row's status
 * (draft/accepted/rejected/needs_more_research), set from the existing
 * Accept/Reject/Research More buttons on /research. Only an 'accepted'
 * report's findings ever reach a prompt — a draft or rejected report is
 * exactly as invisible to the writing/metadata/cover departments as if
 * it didn't exist, so nothing unverified ever contaminates a manuscript.
 * Returns plain fact lines in the same shape every other department's
 * `facts` array already uses (see lib/writing-agent.ts's story_bible
 * splice for the precedent).
 */
export async function fetchAcceptedResearchFacts(supabase: SupabaseClient, projectId: string): Promise<string[]> {
  const { data: report } = await supabase
    .from("research_reports")
    .select("sections")
    .eq("project_id", projectId)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report?.sections) return [];
  const sections = report.sections as Record<string, string>;

  return [
    "Accepted research findings for this book (from InkFrame's Research workspace — evidence-based, not guaranteed):",
    sections.recommended_angle ? `Recommended angle: ${sections.recommended_angle}` : null,
    sections.differentiation_strategy ? `Differentiation strategy: ${sections.differentiation_strategy}` : null,
    sections.market_gaps ? `Content gaps to address: ${sections.market_gaps}` : null,
    sections.keyword_opportunities ? `Keyword opportunities: ${sections.keyword_opportunities}` : null,
  ].filter((l): l is string => !!l);
}

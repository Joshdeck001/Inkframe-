import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, resolvePreferredProvider, type ToolSpec } from "@/lib/ai-client";
import { searchWeb } from "@/lib/web-research-client";

const ASSESSMENTS = ["very_promising", "promising", "moderate", "high_competition", "difficult", "insufficient_data"] as const;
const CONFIDENCE = ["low", "medium", "high", "insufficient_data"] as const;

export type ResearchReportSections = {
  market_overview: string;
  niche_assessment: string;
  audience: string;
  competitor_landscape: string;
  review_insights: string;
  market_gaps: string;
  keyword_opportunities: string;
  category_opportunities: string;
  pricing_positioning: string;
  risks: string;
  opportunities: string;
  recommended_angle: string;
  differentiation_strategy: string;
  final_recommendation: string;
};

export type ResearchReport = {
  sections: ResearchReportSections;
  overall_assessment: (typeof ASSESSMENTS)[number];
  confidence_level: (typeof CONFIDENCE)[number];
  evidence_summary: string;
};

const REPORT_TOOL: ToolSpec = {
  name: "build_research_report",
  description: "Synthesize a research report strictly from the evidence provided — never invent competitors, numbers, or sources not given.",
  input_schema: {
    type: "object" as const,
    properties: {
      sections: {
        type: "object",
        properties: {
          market_overview: { type: "string" },
          niche_assessment: { type: "string" },
          audience: { type: "string" },
          competitor_landscape: { type: "string", description: "Synthesize ONLY from the competitor rows given — say so plainly if none were provided." },
          review_insights: { type: "string", description: "Aggregate patterns from the review-related fields given, never a fabricated quote." },
          market_gaps: { type: "string", description: "A gap must be justified by the evidence given, not just 'the AI can't think of a competitor'." },
          keyword_opportunities: { type: "string" },
          category_opportunities: { type: "string" },
          pricing_positioning: { type: "string" },
          risks: { type: "string" },
          opportunities: { type: "string" },
          recommended_angle: { type: "string" },
          differentiation_strategy: { type: "string" },
          final_recommendation: {
            type: "string",
            description: "Use evidence-based language ('the available evidence suggests', 'additional research recommended') — never guarantee success.",
          },
        },
        required: [
          "market_overview", "niche_assessment", "audience", "competitor_landscape", "review_insights",
          "market_gaps", "keyword_opportunities", "category_opportunities", "pricing_positioning", "risks",
          "opportunities", "recommended_angle", "differentiation_strategy", "final_recommendation",
        ],
      },
      overall_assessment: {
        type: "string",
        enum: [...ASSESSMENTS],
        description: "A qualitative label only, justified by the evidence given. Use 'insufficient_data' honestly when little evidence was provided — never inflate confidence to seem more useful.",
      },
      confidence_level: { type: "string", enum: [...CONFIDENCE] },
      evidence_summary: { type: "string", description: "Plainly state how much real evidence (competitor/keyword/category rows, live search results) was actually available versus how much of this report is AI synthesis." },
    },
    required: ["sections", "overall_assessment", "confidence_level", "evidence_summary"],
  },
};

/**
 * Builds a research report strictly from what's actually in the
 * database — the competitor/keyword/category rows the author entered
 * themselves, plus a live web search attempt that's included only if a
 * provider is actually configured (lib/web-research-client.ts). The
 * model is never asked to invent competitors or numbers; when little or
 * no evidence exists, the honest answer is 'insufficient_data', not a
 * plausible-sounding guess. Never computes a numeric score — see the
 * migration's comment on why that would be fabricated data.
 */
export async function generateResearchReport(supabase: SupabaseClient, projectId: string): Promise<ResearchReport> {
  const [{ data: project }, { data: identity }, { data: audience }, { data: competitors }, { data: keywords }, { data: categories }, { data: notes }] =
    await Promise.all([
      supabase.from("projects").select("book_type").eq("id", projectId).single(),
      supabase.from("project_identity").select("working_title, subtitle, initial_idea").eq("project_id", projectId).maybeSingle(),
      supabase.from("project_audience").select("target_audience, core_promise").eq("project_id", projectId).maybeSingle(),
      supabase.from("competitor_research").select("*").eq("project_id", projectId),
      supabase.from("keyword_research").select("*").eq("project_id", projectId),
      supabase.from("category_research").select("*").eq("project_id", projectId),
      supabase.from("research_notes").select("research_type, content, source_type").eq("project_id", projectId),
    ]);

  const searchQuery = [identity?.working_title, project?.book_type, audience?.target_audience].filter(Boolean).join(" ");
  const webResult = searchQuery ? await searchWeb(searchQuery) : { available: false as const, reason: "No title/audience set yet to search for." };

  const evidenceBlock = [
    `Book type: ${project?.book_type ?? "unknown"}`,
    identity?.working_title ? `Working title: ${identity.working_title}` : null,
    identity?.subtitle ? `Subtitle: ${identity.subtitle}` : null,
    identity?.initial_idea ? `Idea: ${identity.initial_idea}` : null,
    audience?.target_audience ? `Target audience: ${audience.target_audience}` : null,
    audience?.core_promise ? `Core promise: ${audience.core_promise}` : null,
    "",
    `COMPETITOR EVIDENCE PROVIDED (${competitors?.length ?? 0} row(s)):`,
    ...(competitors ?? []).map(
      (c) =>
        `- "${c.title}"${c.author ? ` by ${c.author}` : ""} [${c.source_type}]: price=${c.price ?? "?"}, rating=${c.rating ?? "?"}, reviews=${c.review_count ?? "?"}, ` +
        `complaints="${c.recurring_complaints ?? ""}", praise="${c.recurring_praise ?? ""}", gap="${c.content_gap ?? ""}"`
    ),
    competitors?.length ? null : "(none provided — do not invent competitors)",
    "",
    `KEYWORD EVIDENCE PROVIDED (${keywords?.length ?? 0} row(s)):`,
    ...(keywords ?? []).map((k) => `- "${k.keyword}" [${k.source_type}]: demand=${k.demand_signal ?? "?"}, competition=${k.competition_signal ?? "?"}`),
    keywords?.length ? null : "(none provided — say DATA NOT AVAILABLE rather than inventing search volumes)",
    "",
    `CATEGORY EVIDENCE PROVIDED (${categories?.length ?? 0} row(s)):`,
    ...(categories ?? []).map((c) => `- "${c.category_name}" [${c.source_type}]: ${c.rationale ?? ""}`),
    categories?.length ? null : "(none provided)",
    "",
    `PRIOR AI-INFERENCE NOTES (already labeled as not live data):`,
    ...(notes ?? []).map((n) => `- [${n.research_type}] ${n.content?.slice(0, 300) ?? ""}`),
    "",
    "LIVE WEB SEARCH:",
    webResult.available
      ? webResult.results.map((r) => `- ${r.title} (${r.url}): ${r.snippet}`).join("\n") || "(search ran, no results returned)"
      : `NOT AVAILABLE — ${webResult.reason}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const { output } = await generateStructured<ResearchReport>({
    system:
      "You are InkFrame's Research Department, building an evidence-based research report. Use ONLY the " +
      "evidence given below — real competitor/keyword/category rows the author entered, and live web search " +
      "results only if marked available. Never invent competitors, review quotes, search volumes, or sales " +
      "data. Where evidence is thin, say so plainly and use 'insufficient_data' rather than a confident-" +
      "sounding guess. Call the build_research_report tool.",
    userContent: evidenceBlock,
    tool: REPORT_TOOL,
    maxTokens: 3000,
    preferredProvider: await resolvePreferredProvider(supabase, projectId),
  });

  return output;
}

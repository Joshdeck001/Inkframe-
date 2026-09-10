import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, resolvePreferredProvider, type ToolSpec } from "@/lib/ai-client";
import { searchWeb } from "@/lib/web-research-client";

const ASSESSMENTS = ["very_promising", "promising", "moderate", "high_competition", "difficult", "insufficient_data"] as const;
const CONFIDENCE = ["low", "medium", "high", "insufficient_data"] as const;

export type ResearchReportSections = {
  executive_summary: string;
  market_overview: string;
  niche_assessment: string;
  audience: string;
  amazon_analysis: string;
  google_analysis: string;
  kobo_analysis: string;
  platform_scorecard: string;
  competitor_landscape: string;
  review_insights: string;
  market_gaps: string;
  keyword_opportunities: string;
  keyword_frequency: string;
  title_patterns: string;
  category_opportunities: string;
  pricing_positioning: string;
  trend_signals: string;
  bundle_and_series_opportunities: string;
  risks: string;
  opportunities: string;
  recommended_angle: string;
  differentiation_strategy: string;
  next_actions: string;
  chief_research_conclusion: string;
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
          executive_summary: { type: "string", description: "3-5 sentence summary of the whole investigation and its headline finding." },
          market_overview: { type: "string" },
          niche_assessment: { type: "string" },
          audience: { type: "string" },
          amazon_analysis: {
            type: "string",
            description: "Only write real Amazon-specific conclusions if the platform evidence breakdown given actually shows Amazon-tagged rows. If it doesn't, say plainly 'insufficient evidence tagged to Amazon' — never fill this with general findings dressed up as Amazon-specific.",
          },
          google_analysis: {
            type: "string",
            description: "Same rule as amazon_analysis, for Google Play — only real evidence, honestly say insufficient evidence otherwise. Focus on search/discovery intent (natural keyword relevance, long-tail questions), never keyword-stuffing advice.",
          },
          kobo_analysis: {
            type: "string",
            description: "Same rule as amazon_analysis, for Kobo. Never invent Kobo's ranking mechanics — they aren't publicly documented; distinguish known requirements from inference explicitly if you mention any.",
          },
          platform_scorecard: {
            type: "string",
            description: "A plain-text comparison table across Amazon/Google Play/Kobo using ONLY the platform evidence breakdown given (competitor/keyword counts actually tagged to each). Any platform with hasEvidence=false must show 'N/A — insufficient evidence' in every column, never a filled-in number.",
          },
          competitor_landscape: { type: "string", description: "Synthesize ONLY from the competitor rows given — say so plainly if none were provided." },
          review_insights: { type: "string", description: "Aggregate patterns from the review-related fields given, never a fabricated quote." },
          market_gaps: { type: "string", description: "A gap must be justified by the evidence given, not just 'the AI can't think of a competitor'. Reference the computed gap list if provided." },
          keyword_opportunities: { type: "string" },
          keyword_frequency: { type: "string", description: "Reference the ACTUAL computed frequency numbers given (occurrences/corpus size/percentage) — never restate them differently or invent additional ones." },
          title_patterns: { type: "string", description: "Describe patterns only from the actual competitor titles given, or say there weren't enough titles to find a pattern." },
          category_opportunities: { type: "string" },
          pricing_positioning: { type: "string" },
          trend_signals: { type: "string", description: "Only claim a trend direction (rising/stable/declining/uncertain) when the evidence actually supports it — default to 'uncertain' rather than guessing." },
          bundle_and_series_opportunities: {
            type: "string",
            description: "Only recommend combining topics into one product when the evidence shows they serve overlapping reader intent — never just to pad word count. Explain who it's for and what the reader gains.",
          },
          risks: { type: "string" },
          opportunities: { type: "string" },
          recommended_angle: { type: "string" },
          differentiation_strategy: { type: "string" },
          next_actions: { type: "string", description: "Concrete next steps the author could take — e.g. 'add more competitor rows', 'run keyword research', 'approve an opportunity and create a project'." },
          chief_research_conclusion: {
            type: "string",
            description: "A concise executive decision block, in this exact shape as plain text with each label on its own line: Recommended opportunity / Primary audience / Best positioning / Amazon / Google / Kobo / Primary keyword cluster / Major competitive advantage / Biggest risk / Series potential / Confidence / Recommended next action. Every line must be grounded in evidence actually given above — write 'insufficient evidence' for any line that isn't.",
          },
          final_recommendation: {
            type: "string",
            description: "Use evidence-based language ('the available evidence suggests', 'additional research recommended') — never guarantee success or sales.",
          },
        },
        required: [
          "executive_summary", "market_overview", "niche_assessment", "audience", "amazon_analysis",
          "google_analysis", "kobo_analysis", "platform_scorecard",
          "competitor_landscape", "review_insights", "market_gaps", "keyword_opportunities", "keyword_frequency",
          "title_patterns", "category_opportunities", "pricing_positioning", "trend_signals",
          "bundle_and_series_opportunities", "risks", "opportunities", "recommended_angle",
          "differentiation_strategy", "next_actions", "chief_research_conclusion", "final_recommendation",
        ],
      },
      overall_assessment: {
        type: "string",
        enum: [...ASSESSMENTS],
        description: "A qualitative label only, justified by the evidence given. Use 'insufficient_data' honestly when little evidence was provided — never inflate confidence to seem more useful.",
      },
      confidence_level: { type: "string", enum: [...CONFIDENCE] },
      evidence_summary: { type: "string", description: "Plainly state how much real evidence (competitor/keyword/category rows, live search results, computed frequency/gap/opportunity data) was actually available versus how much of this report is AI synthesis." },
    },
    required: ["sections", "overall_assessment", "confidence_level", "evidence_summary"],
  },
};

type EvidenceRow = Record<string, unknown>;

async function fetchEvidence(supabase: SupabaseClient, filterCol: "project_id" | "session_id", id: string) {
  const [{ data: competitors }, { data: keywords }, { data: categories }, { data: notes }] = await Promise.all([
    supabase.from("competitor_research").select("*").eq(filterCol, id),
    supabase.from("keyword_research").select("*").eq(filterCol, id),
    supabase.from("category_research").select("*").eq(filterCol, id),
    supabase.from("research_notes").select("research_type, content, source_type").eq(filterCol, id),
  ]);
  return {
    competitors: (competitors ?? []) as EvidenceRow[],
    keywords: (keywords ?? []) as EvidenceRow[],
    categories: (categories ?? []) as EvidenceRow[],
    notes: (notes ?? []) as EvidenceRow[],
  };
}

function evidenceBlockFrom(
  header: string[],
  competitors: EvidenceRow[],
  keywords: EvidenceRow[],
  categories: EvidenceRow[],
  notes: EvidenceRow[],
  webResult: Awaited<ReturnType<typeof searchWeb>> | null,
  computed: string[] = []
): string {
  return [
    ...header,
    "",
    `COMPETITOR EVIDENCE PROVIDED (${competitors.length} row(s)):`,
    ...competitors.map(
      (c) =>
        `- "${c.title}"${c.author ? ` by ${c.author}` : ""} [${c.source_type}]: price=${c.price ?? "?"}, rating=${c.rating ?? "?"}, reviews=${c.review_count ?? "?"}, ` +
        `complaints="${c.recurring_complaints ?? ""}", praise="${c.recurring_praise ?? ""}", gap="${c.content_gap ?? ""}", strengths="${c.strengths ?? ""}"`
    ),
    competitors.length ? null : "(none provided — do not invent competitors)",
    "",
    `KEYWORD EVIDENCE PROVIDED (${keywords.length} row(s)):`,
    ...keywords.map((k) => `- "${k.keyword}" [${k.source_type}]: demand=${k.demand_signal ?? "?"}, competition=${k.competition_signal ?? "?"}`),
    keywords.length ? null : "(none provided — say DATA NOT AVAILABLE rather than inventing search volumes)",
    "",
    `CATEGORY EVIDENCE PROVIDED (${categories.length} row(s)):`,
    ...categories.map((c) => `- "${c.category_name}" [${c.source_type}]: ${c.rationale ?? ""}`),
    categories.length ? null : "(none provided)",
    "",
    "PRIOR AI-INFERENCE NOTES (already labeled as not live data):",
    ...notes.map((n) => `- [${n.research_type}] ${String(n.content ?? "").slice(0, 300)}`),
    "",
    ...computed,
    "",
    "LIVE WEB SEARCH:",
    webResult
      ? webResult.available
        ? webResult.results.map((r) => `- ${r.title} (${r.url}): ${r.snippet}`).join("\n") || "(search ran, no results returned)"
        : `NOT AVAILABLE — ${webResult.reason}`
      : "NOT ATTEMPTED for this report.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Builds a research report strictly from what's actually in the
 * database. Two scopes, one function, one tool schema: `projectId` alone
 * is the original behavior (a book project's own evidence rows) —
 * unchanged for every existing caller. `sessionId` additionally pulls a
 * standalone research session's evidence and, when present, the real
 * computed frequency/gap/opportunity numbers from research_findings
 * (lib/research-frequency.ts / lib/research-gaps.ts /
 * lib/research-opportunity.ts) so the AI is synthesizing prose around
 * numbers that were actually calculated, never inventing them itself.
 */
export async function generateResearchReport(
  supabase: SupabaseClient,
  scope: { projectId?: string; sessionId?: string }
): Promise<ResearchReport> {
  const { projectId, sessionId } = scope;
  if (!projectId && !sessionId) throw new Error("generateResearchReport requires a projectId or sessionId.");

  const [projectEvidence, sessionEvidence] = await Promise.all([
    projectId ? fetchEvidence(supabase, "project_id", projectId) : null,
    sessionId ? fetchEvidence(supabase, "session_id", sessionId) : null,
  ]);

  const competitors = [...(projectEvidence?.competitors ?? []), ...(sessionEvidence?.competitors ?? [])];
  const keywords = [...(projectEvidence?.keywords ?? []), ...(sessionEvidence?.keywords ?? [])];
  const categories = [...(projectEvidence?.categories ?? []), ...(sessionEvidence?.categories ?? [])];
  const notes = [...(projectEvidence?.notes ?? []), ...(sessionEvidence?.notes ?? [])];

  let header: string[] = [];
  let preferredProvider: Awaited<ReturnType<typeof resolvePreferredProvider>> = undefined;
  let searchQuery = "";

  if (projectId) {
    const [{ data: project }, { data: identity }, { data: audience }] = await Promise.all([
      supabase.from("projects").select("book_type").eq("id", projectId).single(),
      supabase.from("project_identity").select("working_title, subtitle, initial_idea").eq("project_id", projectId).maybeSingle(),
      supabase.from("project_audience").select("target_audience, core_promise").eq("project_id", projectId).maybeSingle(),
    ]);
    header = [
      `Book type: ${project?.book_type ?? "unknown"}`,
      identity?.working_title ? `Working title: ${identity.working_title}` : null,
      identity?.subtitle ? `Subtitle: ${identity.subtitle}` : null,
      identity?.initial_idea ? `Idea: ${identity.initial_idea}` : null,
      audience?.target_audience ? `Target audience: ${audience.target_audience}` : null,
      audience?.core_promise ? `Core promise: ${audience.core_promise}` : null,
    ].filter((l): l is string => l !== null);
    searchQuery = [identity?.working_title, project?.book_type, audience?.target_audience].filter(Boolean).join(" ");
    preferredProvider = await resolvePreferredProvider(supabase, projectId);
  }

  let computed: string[] = [];
  if (sessionId) {
    const { data: session } = await supabase.from("research_sessions").select("topic, mode, platforms").eq("id", sessionId).maybeSingle();
    header.push(
      `Research topic: ${session?.topic || "(no topic given — general opportunity discovery)"}`,
      `Research mode: ${session?.mode ?? "full_publishing_research"}`,
      `Platforms of interest (as stated by the user, not necessarily all reached live): ${(session?.platforms ?? []).join(", ")}`
    );
    searchQuery = searchQuery || session?.topic || "";

    const { data: findings } = await supabase.from("research_findings").select("*").eq("session_id", sessionId).maybeSingle();
    if (findings) {
      computed = [
        "COMPUTED EVIDENCE (real deterministic calculations — cite these numbers exactly, never restate differently):",
        `Keyword clusters found: ${(findings.keyword_clusters as { label: string; keywords: string[] }[]).length}`,
        ...(findings.keyword_clusters as { label: string; keywords: string[] }[]).map((c) => `  - Cluster "${c.label}": ${c.keywords.join(", ")}`),
        `Top word/phrase frequency: ${JSON.stringify((findings.frequency as { top?: unknown }).top ?? findings.frequency).slice(0, 1500)}`,
        `Content gaps found (${(findings.gaps as unknown[]).length}): ${JSON.stringify(findings.gaps).slice(0, 1500)}`,
        `Opportunity score: ${JSON.stringify(findings.opportunity_score).slice(0, 1000)}`,
        `Content-depth coverage matrix (real substring matches against competitor-entered text, beginner/setup/intermediate/troubleshooting/advanced): ${JSON.stringify(findings.coverage_matrix).slice(0, 1500)}`,
        `Platform evidence breakdown — ONLY these platforms have real tagged evidence; any platform not listed here has ZERO evidence and its section/scorecard row must say "insufficient evidence", never a guess: ${JSON.stringify((findings.platform_breakdown as { hasEvidence: boolean }[] | null)?.filter((p) => p.hasEvidence)).slice(0, 1000)}`,
        `Keyword intelligence (real intent classification + specificity from phrase length; hasDemandEvidence/hasCompetitionEvidence show whether a real signal was entered): ${JSON.stringify(findings.keyword_intelligence).slice(0, 1500)}`,
        findings.concepts && (findings.concepts as unknown[]).length
          ? `Recommended concepts already generated: ${JSON.stringify(findings.concepts).slice(0, 2000)}`
          : "No concepts generated yet.",
      ];
    }
  }

  const webResult = searchQuery ? await searchWeb(searchQuery) : { available: false as const, reason: "No topic/title set yet to search for." };

  const evidenceBlock = evidenceBlockFrom(header, competitors, keywords, categories, notes, webResult, computed);

  const { output } = await generateStructured<ResearchReport>({
    system:
      "You are InkFrame's Research Department, building an evidence-based research report — act as the " +
      "final synthesis step of a research team (market/platform/keyword/competition/reader-signal/quality " +
      "specialists), not a single guesser. Use ONLY the evidence given below — real competitor/keyword/" +
      "category rows, computed frequency/gap/opportunity/platform/keyword-intelligence numbers, and live web " +
      "search results only if marked available. Never invent competitors, review quotes, search volumes, " +
      "sales data, or trend directions not supported by the evidence. A platform (Amazon/Google Play/Kobo) " +
      "with no tagged evidence gets 'insufficient evidence', never a filled-in number or a borrowed general " +
      "finding. Where evidence is thin, say so plainly and use 'insufficient_data' rather than a confident-" +
      "sounding guess. Never claim or imply a guaranteed sales outcome — frame everything as decision " +
      "support. Call the build_research_report tool.",
    userContent: evidenceBlock,
    tool: REPORT_TOOL,
    maxTokens: 4500,
    preferredProvider,
  });

  return output;
}

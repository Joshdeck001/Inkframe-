import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, resolvePreferredProviderForUser, type ToolSpec } from "@/lib/ai-client";
import { searchWeb } from "@/lib/web-research-client";
import { wordFrequency, phraseFrequency, clusterKeywords } from "@/lib/research-frequency";
import { findGaps, computeCoverageMatrix, type CompetitorEvidence } from "@/lib/research-gaps";
import { scoreOpportunity } from "@/lib/research-opportunity";
import { computePlatformBreakdown, normalizePlatform } from "@/lib/research-platforms";
import { scoreKeywords } from "@/lib/research-keywords";
import { generateResearchReport } from "@/lib/research-report";

/**
 * The Research Agent's staged investigation, one verifiable step at a
 * time (spec: "do not let one giant AI prompt perform everything"). Each
 * stage function does exactly one thing and is independently callable —
 * lib/research-department.ts's tick wrapper is what sequences them one
 * per background-job tick, same pattern as
 * lib/kdp-preparation-department.ts. Only two of the six stages ever
 * call an AI model (extraction, concepts); discovery is a real HTTP
 * search, and analysis/report/finalize are either pure computation or
 * grounded synthesis over numbers that were already calculated.
 */

export type ResearchSession = {
  id: string;
  user_id: string;
  topic: string;
  mode: string;
  platforms: string[];
  project_id: string | null;
};

// The single source of truth for research_sessions.mode/platforms — every
// caller that creates a session (the form at /api/research/start, and the
// Suggestion Bar's natural-language classifier in lib/suggestion-intent.ts)
// imports these rather than keeping its own copy.
export const RESEARCH_MODES = [
  "book_opportunity",
  "keyword_research",
  "competition_analysis",
  "market_research",
  "topic_research",
  "series_research",
  "metadata_research",
  "trend_research",
  "full_publishing_research",
] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

export const RESEARCH_PLATFORMS = ["amazon", "google_play", "kobo", "web"] as const;
export type ResearchPlatform = (typeof RESEARCH_PLATFORMS)[number];

// ---------------------------------------------------------------------------
// Stage 1: discovery — real web search, honestly reporting unavailability.
// ---------------------------------------------------------------------------
export async function runDiscoveryStage(supabase: SupabaseClient, session: ResearchSession): Promise<{ detail: string }> {
  const topic = session.topic.trim();
  const queries = topic
    ? [topic, `${topic} reviews reader complaints`, `${topic} bestseller keywords`]
    : ["promising self-publishing book niches 2026"];

  let collected = 0;
  let insertFailures = 0;
  for (const q of queries) {
    const result = await searchWeb(q);
    if (result.available) {
      const { error } = await supabase.from("research_notes").insert(
        result.results.map((r) => ({
          session_id: session.id,
          research_type: "web_search",
          content: `${r.title}\n${r.url}\n${r.snippet}`,
          source_type: "live_web" as const,
          confidence: "medium" as const,
        }))
      );
      // Only count results actually saved — a constraint violation or any other
      // insert failure must never be reported as "collected" (that previously
      // happened silently here: research_notes.research_type's CHECK constraint
      // didn't allow 'web_search' until migration 0027, so every one of these
      // inserts was rejected and discarded without anyone knowing).
      if (error) {
        insertFailures++;
        console.error(`runDiscoveryStage: failed to save web_search notes for session ${session.id}:`, error.message);
      } else {
        collected += result.results.length;
      }
    } else {
      const { error } = await supabase.from("research_notes").insert({
        session_id: session.id,
        research_type: "web_search",
        content: `Web search for "${q}" was not available: ${result.reason}`,
        source_type: "ai_inference" as const,
        confidence: "insufficient_data" as const,
      });
      if (error) {
        insertFailures++;
        console.error(`runDiscoveryStage: failed to save unavailability note for session ${session.id}:`, error.message);
      }
    }
  }

  if (insertFailures > 0 && collected === 0) {
    throw new Error(`Discovery stage ran but could not save ${insertFailures} note(s) to the database — check server logs for the underlying error.`);
  }

  return { detail: collected > 0 ? `${collected} web result(s) collected across ${queries.length} search(es).` : "No live web results — search provider unavailable, proceeding on user-provided evidence only." };
}

// ---------------------------------------------------------------------------
// Stage 2: extraction — turn raw search snippets into candidate evidence
// rows, clearly tagged by how they were actually obtained.
// ---------------------------------------------------------------------------
const EXTRACTION_TOOL: ToolSpec = {
  name: "extract_research_candidates",
  description: "Extract candidate competitor books, keywords, and categories STRICTLY from the evidence text given — never invent entities not named or clearly described in it.",
  input_schema: {
    type: "object" as const,
    properties: {
      competitors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            author: { type: "string" },
            positioning: { type: "string" },
            source_url: { type: "string" },
          },
          required: ["title"],
        },
      },
      keywords: {
        type: "array",
        items: { type: "object", properties: { keyword: { type: "string" } }, required: ["keyword"] },
      },
      categories: {
        type: "array",
        items: { type: "object", properties: { category_name: { type: "string" }, rationale: { type: "string" } }, required: ["category_name"] },
      },
    },
    required: ["competitors", "keywords", "categories"],
  },
};

export async function runExtractionStage(supabase: SupabaseClient, session: ResearchSession): Promise<{ detail: string }> {
  const { data: webNotes } = await supabase
    .from("research_notes")
    .select("content")
    .eq("session_id", session.id)
    .eq("research_type", "web_search")
    .eq("source_type", "live_web");

  const hasLiveEvidence = (webNotes?.length ?? 0) > 0;
  const evidenceText = hasLiveEvidence
    ? (webNotes ?? []).map((n) => n.content).join("\n\n")
    : `No live web search results were available. Topic: "${session.topic || "(none given)"}". Use general knowledge only, clearly AI-inferred.`;

  const { output } = await generateStructured<{
    competitors: { title: string; author?: string; positioning?: string; source_url?: string }[];
    keywords: { keyword: string }[];
    categories: { category_name: string; rationale?: string }[];
  }>({
    system:
      "You are InkFrame's Research Department extracting structured candidates from research evidence. If the " +
      "evidence is real search results, extract ONLY books/keywords/categories actually named or described in " +
      "them. If no live evidence was given, produce a SHORT, clearly-labeled best-effort list from general " +
      "market knowledge — this will be tagged as AI inference, never presented as live data. Call the tool.",
    userContent: evidenceText,
    tool: EXTRACTION_TOOL,
    maxTokens: 2000,
    preferredProvider: await resolvePreferredProviderForUser(supabase, session.user_id),
  });

  const sourceType = hasLiveEvidence ? "live_web" : "ai_inference";
  const confidence = hasLiveEvidence ? "medium" : "low";

  if (output.competitors.length) {
    await supabase.from("competitor_research").insert(
      output.competitors.map((c) => ({
        session_id: session.id,
        title: c.title,
        author: c.author || null,
        positioning: c.positioning || null,
        source_url: c.source_url || null,
        // Inferred from the URL's own domain, never guessed — a real
        // parse of a real link, so cross-platform intelligence has
        // something to work with even from AI-extracted rows.
        platform: normalizePlatform(c.source_url),
        source_type: sourceType,
        confidence,
      }))
    );
  }
  if (output.keywords.length) {
    await supabase.from("keyword_research").insert(
      output.keywords.map((k) => ({ session_id: session.id, keyword: k.keyword, source_type: sourceType, confidence }))
    );
  }
  if (output.categories.length) {
    await supabase.from("category_research").insert(
      output.categories.map((c) => ({ session_id: session.id, category_name: c.category_name, rationale: c.rationale || null, source_type: sourceType, confidence }))
    );
  }

  return {
    detail: `Extracted ${output.competitors.length} competitor(s), ${output.keywords.length} keyword(s), ${output.categories.length} categor(y/ies), tagged "${sourceType}".`,
  };
}

// ---------------------------------------------------------------------------
// Stage 3: analysis — pure deterministic frequency/cluster/gap/opportunity
// computation over every evidence row the session has (extracted + any
// the user added by hand). No AI call.
// ---------------------------------------------------------------------------
export async function runAnalysisStage(supabase: SupabaseClient, session: ResearchSession): Promise<{ detail: string }> {
  const [{ data: competitors }, { data: keywords }, { data: chapters }] = await Promise.all([
    supabase.from("competitor_research").select("title, content_gap, recurring_complaints, strengths, positioning, platform").eq("session_id", session.id),
    supabase.from("keyword_research").select("keyword, demand_signal, competition_signal, platform").eq("session_id", session.id),
    // Manuscript-as-evidence: when this session is linked to a project that
    // already has written chapters, their real content joins the corpus
    // instead of requiring a separate upload flow — the same evidence, one
    // less step. Titles only (not full prose) to keep the corpus about
    // topic/keyword signal, not accidentally quoting the manuscript itself.
    session.project_id
      ? supabase.from("chapters").select("title").eq("project_id", session.project_id)
      : Promise.resolve({ data: null }),
  ]);

  const titles = (competitors ?? []).map((c) => c.title).filter(Boolean) as string[];
  const keywordList = (keywords ?? []).map((k) => k.keyword).filter(Boolean) as string[];
  const chapterTitles = (chapters ?? []).map((c) => c.title).filter(Boolean) as string[];
  const corpus = [...titles, ...keywordList, ...chapterTitles];

  const clusters = clusterKeywords(keywordList);
  const gaps = findGaps(clusters, (competitors ?? []) as CompetitorEvidence[]);
  const opportunity = scoreOpportunity({
    competitorCount: competitors?.length ?? 0,
    clusters,
    gaps,
    keywordsWithDemandSignal: (keywords ?? []).filter((k) => !!k.demand_signal).length,
    seriesSignals: (competitors ?? []).filter((c) => /series/i.test(`${c.positioning ?? ""} ${c.strengths ?? ""}`)).length,
  });

  const frequency = {
    words: wordFrequency(corpus, 20),
    bigrams: phraseFrequency(corpus, 2, 15),
    trigrams: phraseFrequency(corpus, 3, 10),
  };

  const platformBreakdown = computePlatformBreakdown(competitors ?? [], keywords ?? []);
  const keywordIntelligence = scoreKeywords(keywords ?? []);
  const coverageMatrix = computeCoverageMatrix((competitors ?? []) as { title: string; strengths: string | null; content_gap: string | null }[]);

  await supabase.from("research_findings").upsert(
    {
      session_id: session.id,
      keyword_clusters: clusters,
      frequency,
      gaps,
      opportunity_score: opportunity,
      platform_breakdown: platformBreakdown,
      keyword_intelligence: keywordIntelligence,
      coverage_matrix: coverageMatrix,
    },
    { onConflict: "session_id" }
  );

  return {
    detail: `${clusters.length} keyword cluster(s), ${gaps.length} gap(s) found, opportunity score ${opportunity.overall}/100${chapterTitles.length ? ` (incl. ${chapterTitles.length} chapter title(s) from the linked project)` : ""}.`,
  };
}

// ---------------------------------------------------------------------------
// Stage 4: concepts — "what should I write" recommendations, series and
// bundle opportunities, grounded strictly in the stage-3 computed numbers.
// ---------------------------------------------------------------------------
export type ResearchConcept = {
  concept: string;
  rationale: string[];
  competition_level: "low" | "medium" | "high";
  opportunity_level: "low" | "medium" | "high";
  recommended_format: string;
  series_recommendation: string | null;
  bundle_recommendation: string | null;
  confidence: "low" | "medium" | "high";
};

const CONCEPTS_TOOL: ToolSpec = {
  name: "recommend_concepts",
  description: "Recommend 1-4 book concepts strictly grounded in the computed evidence given — every rationale bullet must reference a real number or finding from that evidence.",
  input_schema: {
    type: "object" as const,
    properties: {
      concepts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            concept: { type: "string" },
            rationale: { type: "array", items: { type: "string" } },
            competition_level: { type: "string", enum: ["low", "medium", "high"] },
            opportunity_level: { type: "string", enum: ["low", "medium", "high"] },
            recommended_format: { type: "string" },
            series_recommendation: { type: "string", description: "Empty string if a series isn't clearly supported by the evidence." },
            bundle_recommendation: { type: "string", description: "Empty string unless multiple topics genuinely serve overlapping reader intent — never suggest bundling just to increase word count." },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["concept", "rationale", "competition_level", "opportunity_level", "recommended_format", "series_recommendation", "bundle_recommendation", "confidence"],
        },
      },
    },
    required: ["concepts"],
  },
};

export async function runConceptsStage(supabase: SupabaseClient, session: ResearchSession): Promise<{ detail: string }> {
  const { data: findings } = await supabase.from("research_findings").select("*").eq("session_id", session.id).maybeSingle();
  if (!findings) throw new Error("Analysis stage hasn't run yet — no computed findings to ground concepts in.");

  const evidence = [
    `Topic: ${session.topic || "(none given — open discovery)"}`,
    `Keyword clusters: ${JSON.stringify(findings.keyword_clusters).slice(0, 2000)}`,
    `Content gaps: ${JSON.stringify(findings.gaps).slice(0, 2000)}`,
    `Opportunity score: ${JSON.stringify(findings.opportunity_score).slice(0, 1000)}`,
    `Content-depth coverage across competitors (beginner/setup/intermediate/troubleshooting/advanced): ${JSON.stringify(findings.coverage_matrix).slice(0, 1500)}`,
    `Platform evidence breakdown (only platforms with real tagged evidence, others omitted rather than guessed): ${JSON.stringify((findings.platform_breakdown as { hasEvidence: boolean }[] | null)?.filter((p) => p.hasEvidence)).slice(0, 1000)}`,
  ].join("\n\n");

  const { output } = await generateStructured<{ concepts: ResearchConcept[] }>({
    system:
      "You are InkFrame's Research Department recommending book concepts. Every rationale bullet MUST cite a " +
      "real number or finding from the computed evidence given (cluster sizes, gap count, opportunity score) — " +
      "never a vague claim like 'strong demand' without pointing at what produced it. Never state or imply a " +
      "concept is guaranteed to sell. Only fill series_recommendation/bundle_recommendation when the evidence " +
      "actually supports it. Call the tool.",
    userContent: evidence,
    tool: CONCEPTS_TOOL,
    maxTokens: 2500,
    preferredProvider: await resolvePreferredProviderForUser(supabase, session.user_id),
  });

  await supabase.from("research_findings").update({ concepts: output.concepts }).eq("session_id", session.id);

  return { detail: `${output.concepts.length} concept(s) recommended.` };
}

// ---------------------------------------------------------------------------
// Stage 5: report — the full evidence-grounded report (lib/research-report.ts).
// ---------------------------------------------------------------------------
export async function runReportStage(supabase: SupabaseClient, session: ResearchSession): Promise<{ detail: string }> {
  const report = await generateResearchReport(supabase, { sessionId: session.id, projectId: session.project_id ?? undefined });
  await supabase.from("research_reports").insert({
    session_id: session.id,
    project_id: session.project_id,
    sections: report.sections,
    overall_assessment: report.overall_assessment,
    confidence_level: report.confidence_level,
    evidence_summary: report.evidence_summary,
    status: "draft",
  });

  const { data: competitors } = await supabase.from("competitor_research").select("id", { count: "exact", head: true }).eq("session_id", session.id);
  const { data: notes } = await supabase.from("research_notes").select("source_type").eq("session_id", session.id);
  const liveSources = (notes ?? []).filter((n) => n.source_type === "live_web").length;
  const quality = {
    coveragePct: Math.min(100, ((notes?.length ?? 0) + (competitors ? 1 : 0)) * 10),
    evidenceQuality: liveSources > 0 ? "medium" : "low",
    freshness: liveSources > 0 ? "high" : "unknown",
    confidence: report.confidence_level,
    limitations: liveSources === 0 ? ["No live web search was available for this session — findings rely on user-provided data and AI general knowledge only."] : [],
  };
  await supabase.from("research_findings").update({ quality }).eq("session_id", session.id);

  return { detail: `Report generated (assessment: ${report.overall_assessment}, confidence: ${report.confidence_level}).` };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, resolvePreferredProviderForUser, type ToolSpec } from "@/lib/ai-client";
import { RESEARCH_MODES, RESEARCH_PLATFORMS, type ResearchMode } from "@/lib/research-agent";

/**
 * Turns a free-text Suggestion Bar query into a real research_sessions
 * row — the exact same session shape /api/research/start already
 * creates, just derived from natural language instead of a form. This is
 * deliberately the ONLY new piece: research_sessions, the six-stage
 * pipeline (lib/research-agent.ts), evidence tables, and report
 * generation are all reused as-is. No new intent taxonomy either — this
 * maps onto research_sessions' own existing `mode` enum
 * (/api/research/start's MODES) rather than inventing a parallel one.
 *
 * The classifier's first job is honesty about scope: most things typed
 * into a "search your books" box are exactly that — a book title, not a
 * research question — and must fall through to the existing local
 * filter untouched, never hijacked into an unwanted research session.
 */

export type SuggestionClassification = {
  is_research_question: boolean;
  mode: ResearchMode | null;
  topic: string;
  platforms: string[];
  reasoning: string;
};

const CLASSIFY_TOOL: ToolSpec = {
  name: "classify_suggestion_query",
  description:
    "Decide whether a Suggestion Bar query is a real research question InkFrame should investigate, or something else " +
    "(a book title the user is searching their own library for, small talk, gibberish). Never guess yes on a short, " +
    "book-title-shaped phrase — when in doubt, is_research_question is false.",
  input_schema: {
    type: "object" as const,
    properties: {
      is_research_question: {
        type: "boolean",
        description: "True only if this reads as a genuine request to research a market/topic/trend/competitor/keyword — not a book-title lookup.",
      },
      mode: {
        type: ["string", "null"],
        enum: [...RESEARCH_MODES],
        description:
          "The single closest existing research mode. trend_research for 'what's trending'/'what's popular now'; market_research for 'research the market for X'/comparisons; " +
          "competition_analysis for competitor requests; keyword_research for keyword/phrase requests; book_opportunity for 'find me an opportunity'/gap requests; " +
          "series_research for author/series-specific requests; topic_research for reader-problem research, general web research, or anything that doesn't fit the others " +
          "cleanly; full_publishing_research only for an explicit broad 'research everything about X' request. Null when is_research_question is false.",
      },
      topic: {
        type: "string",
        description: "The real subject to research, extracted and cleaned up from the query (e.g. 'beginner photography books for seniors'). Empty string when is_research_question is false.",
      },
      platforms: {
        type: "array",
        items: { type: "string", enum: [...RESEARCH_PLATFORMS] },
        description: "Which of amazon/google_play/kobo/web the query implies (default to all four if unclear). Empty array when is_research_question is false.",
      },
      reasoning: { type: "string", description: "One short sentence explaining the classification." },
    },
    required: ["is_research_question", "mode", "topic", "platforms", "reasoning"],
  },
};

export async function classifySuggestionQuery(supabase: SupabaseClient, userId: string, query: string): Promise<SuggestionClassification> {
  const { output } = await generateStructured<SuggestionClassification>({
    system:
      "You classify one Suggestion Bar query for InkFrame, a book-publishing platform. The bar doubles as a plain " +
      "search box for the user's own book library. Only mark is_research_question true for a genuine market/topic/" +
      "trend/competitor/keyword/reader-problem/opportunity research request — a short phrase that looks like it could " +
      "just be a book title (e.g. 'The Entrepreneur Blueprint', 'my novel', 'chapter 3 draft') is NOT a research " +
      "question. Call classify_suggestion_query.",
    userContent: query,
    tool: CLASSIFY_TOOL,
    maxTokens: 500,
    preferredProvider: await resolvePreferredProviderForUser(supabase, userId),
  });
  return output;
}

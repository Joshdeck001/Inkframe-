import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, resolvePreferredProviderForUser, type ToolSpec } from "@/lib/ai-client";

/**
 * Book Intelligence Workspace — what happens to a single InkframeScout
 * capture after the click, not just where it's stored. Explicitly NOT a
 * cloning tool and explicitly NOT a re-introduction of anything already
 * declined this project (a fabricated BSR-to-sales conversion, an opaque
 * single-number "Intelligence Score", automated multi-book scanning).
 * Everything here is grounded strictly in the real fields one clip
 * actually captured (title/author/publisher/category/price/rating/
 * review_count/bsr/category_rank/published_date/isbn — see scout_clips)
 * plus, for concepts, the opportunity ideas this same module already
 * generated. Two real AI calls, each independently callable and each
 * clearly labeled AI inference/recommendation in the app's own evidence
 * vocabulary (lib/research-evidence-labels.ts) — never presented as fact.
 */

export type BookClipEvidence = {
  title: string;
  author: string | null;
  publisher: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  review_count: number | null;
  bsr: number | null;
  category_rank: number | null;
  published_date: string | null;
  isbn: string | null;
  marketplace: string;
};

export const OPPORTUNITY_CATEGORIES = [
  "remodel", "gap", "audience", "depth", "practical", "updated", "series", "combination", "beginner_advanced", "regional_platform",
] as const;
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

export const OPPORTUNITY_CATEGORY_LABEL: Record<OpportunityCategory, string> = {
  remodel: "Remodel",
  gap: "Gap",
  audience: "Audience",
  depth: "Depth",
  practical: "Practical",
  updated: "Updated",
  series: "Series",
  combination: "Combination",
  beginner_advanced: "Beginner/Advanced",
  regional_platform: "Regional/Platform",
};

export type OpportunityIdea = {
  category: OpportunityCategory;
  title: string;
  why_it_exists: string;
  evidence_supporting: string[];
  what_would_differ: string;
  evidence_gaps: string[];
};

export type BookIntelligenceAnalysis = {
  book_snapshot: { topic: string; audience: string; format: string | null; series_info: string | null };
  whats_working: string[];
  whats_missing: string[];
  opportunity_ideas: OpportunityIdea[];
};

function evidenceText(clip: BookClipEvidence): string {
  return [
    `Title: "${clip.title}"`,
    clip.author ? `Author: ${clip.author}` : "Author: Unknown",
    clip.publisher ? `Publisher: ${clip.publisher}` : "Publisher: Unknown",
    clip.category ? `Category: ${clip.category}` : "Category: Unknown",
    clip.price != null ? `Price: ${clip.currency ?? "$"}${clip.price}` : "Price: Unknown",
    clip.rating != null ? `Rating: ${clip.rating}` : "Rating: Unknown",
    clip.review_count != null ? `Review count: ${clip.review_count}` : "Review count: Unknown",
    clip.bsr != null ? `Best Sellers Rank (observed at capture time): #${clip.bsr}` : "BSR: Not captured",
    clip.category_rank != null ? `Category rank (observed at capture time): #${clip.category_rank}` : "Category rank: Not captured",
    clip.published_date ? `Publication date: ${clip.published_date}` : "Publication date: Unknown",
    clip.isbn ? `ISBN: ${clip.isbn}` : "ISBN: Unknown",
    `Marketplace: ${clip.marketplace}`,
  ].join("\n");
}

const ANALYSIS_TOOL: ToolSpec = {
  name: "analyze_book_intelligence",
  description: "Analyze one real captured book listing — what it appears to do, what's working, what may be missing, and what original (non-cloning) opportunities the underlying reader problem suggests.",
  input_schema: {
    type: "object" as const,
    properties: {
      book_snapshot: {
        type: "object",
        properties: {
          topic: { type: "string", description: "What this book appears to be about, inferred only from its title/category/publisher — never invented." },
          audience: { type: "string", description: "Who it appears to target, inferred from title/category/price positioning." },
          format: { type: "string", description: "Apparent format (e.g. guide, workbook, novel, reference) if inferable from the title/category; otherwise 'Unclear from captured evidence'." },
          series_info: { type: "string", description: "Empty string unless the title itself suggests series/numbering (e.g. 'Book 2', 'Volume III') — never guessed otherwise." },
        },
        required: ["topic", "audience", "format", "series_info"],
      },
      whats_working: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "Strengths inferable ONLY from the real evidence given (rating, review count, category fit, title/subtitle structure, apparent positioning) — e.g. 'high review count relative to a niche category suggests strong reader engagement'. Never invent a strength with no evidentiary basis.",
      },
      whats_missing: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "Segments, subtopics, or angles the evidence suggests this book may under-serve (audience segment, beginner/advanced angle, practical companion material, modernized treatment, etc). Explicitly speculative — every entry must read as inference, not a confirmed fact.",
      },
      opportunity_ideas: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: [...OPPORTUNITY_CATEGORIES] },
            title: { type: "string", description: "A short name for this opportunity, not a finished book title." },
            why_it_exists: { type: "string" },
            evidence_supporting: { type: "array", items: { type: "string" }, maxItems: 4 },
            what_would_differ: { type: "string", description: "What would make a new product meaningfully different from this captured book — never a rewrite or close paraphrase of it." },
            evidence_gaps: { type: "array", items: { type: "string" }, maxItems: 4, description: "What's NOT known that would strengthen this opportunity — say plainly when there's little to go on." },
          },
          required: ["category", "title", "why_it_exists", "evidence_supporting", "what_would_differ", "evidence_gaps"],
        },
        description: "Only propose opportunities a category from the enum actually fits and the given evidence can plausibly support — fewer, well-grounded ideas beat a padded list.",
      },
    },
    required: ["book_snapshot", "whats_working", "whats_missing", "opportunity_ideas"],
  },
};

export async function analyzeBookIntelligence(supabase: SupabaseClient, userId: string, clip: BookClipEvidence): Promise<BookIntelligenceAnalysis> {
  const { output } = await generateStructured<BookIntelligenceAnalysis>({
    system:
      "You are InkFrame's market-intelligence analyst turning one real captured book listing into research a self-publishing author can act on. Use ONLY the " +
      "real fields given below — never fabricate sales figures, never invent a BSR-to-sales conversion, never produce a single opaque score. This is NOT a " +
      "cloning tool: 'opportunity_ideas' must describe genuinely different products built around the same underlying reader problem, never a rewrite, close " +
      "paraphrase, or reproduction of this book's own title, subtitle, description, or structure. Every claim in whats_working/whats_missing must be traceable " +
      "to a real field given (rating, review count, category, title wording, publisher) — if the evidence is thin, say so plainly rather than padding the " +
      "list. Call the analyze_book_intelligence tool.",
    userContent: evidenceText(clip),
    tool: ANALYSIS_TOOL,
    maxTokens: 3000,
    preferredProvider: await resolvePreferredProviderForUser(supabase, userId),
  });
  return output;
}

export type BookConcept = {
  concept: string;
  target_reader: string;
  reader_problem: string;
  differentiation: string;
  title_direction: string;
  subtitle_direction: string;
  content_angle: string;
  structure: string;
  competitive_advantage: string;
  evidence_supporting: string[];
  evidence_gaps: string[];
  risks: string[];
  confidence: "low" | "medium" | "high";
};

const CONCEPTS_TOOL: ToolSpec = {
  name: "generate_book_concepts",
  description: "Generate 1-4 original book concepts from the given opportunity ideas — never a rewrite of the source book.",
  input_schema: {
    type: "object" as const,
    properties: {
      concepts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            concept: { type: "string", description: "One-sentence description of the proposed book." },
            target_reader: { type: "string" },
            reader_problem: { type: "string" },
            differentiation: { type: "string", description: "How this is meaningfully different from the captured book — never a paraphrase of it." },
            title_direction: { type: "string", description: "A working-title DIRECTION, not a final title — e.g. 'Something naming the specific pain point + the outcome', not a polished title itself unless it's clearly just an example." },
            subtitle_direction: { type: "string" },
            content_angle: { type: "string" },
            structure: { type: "string", description: "Suggested structure/outline shape at a high level (e.g. 'problem -> framework -> 10 worked examples -> troubleshooting')." },
            competitive_advantage: { type: "string" },
            evidence_supporting: { type: "array", items: { type: "string" }, maxItems: 4 },
            evidence_gaps: { type: "array", items: { type: "string" }, maxItems: 4 },
            risks: { type: "array", items: { type: "string" }, maxItems: 4 },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: [
            "concept", "target_reader", "reader_problem", "differentiation", "title_direction", "subtitle_direction",
            "content_angle", "structure", "competitive_advantage", "evidence_supporting", "evidence_gaps", "risks", "confidence",
          ],
        },
      },
    },
    required: ["concepts"],
  },
};

export async function generateBookConcepts(
  supabase: SupabaseClient,
  userId: string,
  clip: BookClipEvidence,
  opportunityIdeas: OpportunityIdea[]
): Promise<{ concepts: BookConcept[] }> {
  const evidence = [
    evidenceText(clip),
    "",
    "OPPORTUNITY IDEAS ALREADY IDENTIFIED (ground every concept in one or more of these, don't invent a new direction unrelated to them):",
    ...opportunityIdeas.map(
      (o, i) =>
        `${i + 1}. [${o.category}] ${o.title} — ${o.why_it_exists} | What would differ: ${o.what_would_differ} | Evidence gaps: ${o.evidence_gaps.join("; ") || "none noted"}`
    ),
  ].join("\n");

  const { output } = await generateStructured<{ concepts: BookConcept[] }>({
    system:
      "You are InkFrame's Research Department turning already-identified opportunity ideas into concrete original book concepts. Every concept must be " +
      "clearly grounded in one or more of the opportunity ideas given — cite them. Never suggest reusing the source book's own title, subtitle, or content. " +
      "Use evidence-based, non-guaranteeing language — never imply a concept is certain to sell. Be honest in evidence_gaps and confidence rather than " +
      "inflating either. Call the generate_book_concepts tool.",
    userContent: evidence,
    tool: CONCEPTS_TOOL,
    maxTokens: 3500,
    preferredProvider: await resolvePreferredProviderForUser(supabase, userId),
  });
  return output;
}

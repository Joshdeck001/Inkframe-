import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, resolvePreferredProviderForUser, type ToolSpec } from "@/lib/ai-client";

/**
 * "What would you build instead?" (spec section 10) — explicitly NOT a
 * cloning tool. Takes the real, already-collected fields of one or more
 * competitor clips and asks the model for original market directions
 * grounded in those observable signals — never a rewrite or close
 * paraphrase of the source book's own title, subtitle, description, or
 * cover concept. The result is always AI-generated brainstorming
 * (RECOMMENDED in the app's evidence vocabulary), shown as directions to
 * consider, never as a ready-to-publish spec.
 */

export type DifferentiationEvidence = {
  title: string;
  author: string | null;
  category: string | null;
  price: number | null;
  rating: number | null;
  review_count: number | null;
};

export type DifferentiationResult = {
  what_the_book_does: { topic: string; audience: string; promise: string; positioning: string; observable_strengths: string[] };
  possible_gaps: string[];
  differentiation_directions: string[];
};

function differentiationTool(): ToolSpec {
  return {
    name: "analyze_differentiation",
    description: "Analyze what a competitor book does and suggest original market directions distinct from it — never a clone.",
    input_schema: {
      type: "object" as const,
      properties: {
        what_the_book_does: {
          type: "object",
          properties: {
            topic: { type: "string" },
            audience: { type: "string" },
            promise: { type: "string", description: "The reader benefit this book appears to promise, inferred only from the observable evidence given." },
            positioning: { type: "string" },
            observable_strengths: { type: "array", items: { type: "string" }, maxItems: 5 },
          },
          required: ["topic", "audience", "promise", "positioning", "observable_strengths"],
        },
        possible_gaps: {
          type: "array",
          items: { type: "string" },
          maxItems: 6,
          description: "Segments, subtopics, or positioning angles the observable evidence suggests this book may under-serve. Speculative, not confirmed.",
        },
        differentiation_directions: {
          type: "array",
          items: { type: "string" },
          maxItems: 6,
          description:
            "Original market directions a different book could take (alternative audience, problem, structure, positioning, format, or series angle). " +
            "Each must be a genuinely different concept — never a reworded version of the source book's own title, subtitle, description, or cover, " +
            "and never instructions to reproduce its actual content.",
        },
      },
      required: ["what_the_book_does", "possible_gaps", "differentiation_directions"],
    },
  };
}

export async function generateDifferentiation(supabase: SupabaseClient, userId: string, evidence: DifferentiationEvidence[]): Promise<DifferentiationResult> {
  const facts = evidence
    .map(
      (e, i) =>
        `Book ${i + 1}: "${e.title}"${e.author ? ` by ${e.author}` : ""}` +
        `${e.category ? ` — category: ${e.category}` : ""}${e.price != null ? ` — price: $${e.price}` : ""}` +
        `${e.rating != null ? ` — rating: ${e.rating}` : ""}${e.review_count != null ? ` — review count: ${e.review_count}` : ""}`
    )
    .join("\n");

  const { output } = await generateStructured<DifferentiationResult>({
    system:
      "You are InkFrame's market-intelligence analyst. Given real, observed marketplace facts about one or more competitor books " +
      "(title, author, category, price, rating, review count — nothing else is known), infer what the book likely does and where " +
      "an original, different book might find room. This is NOT a cloning tool: never suggest reusing the source book's exact title, " +
      "subtitle, description wording, or cover concept, and never generate instructions to reproduce its actual content. Every " +
      "direction you propose must describe a genuinely different book. Be explicit that gaps and directions are inferred " +
      "possibilities based on limited observable data, not confirmed facts. Call the analyze_differentiation tool.",
    userContent: facts,
    tool: differentiationTool(),
    maxTokens: 1500,
    preferredProvider: await resolvePreferredProviderForUser(supabase, userId),
  });

  return output;
}

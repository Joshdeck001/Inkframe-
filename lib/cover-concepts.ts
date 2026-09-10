import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, resolvePreferredProviderForUser, type ToolSpec } from "@/lib/ai-client";
import { assembleCoverBrief, coverBriefToPromptFacts } from "@/lib/cover-brief";

/**
 * Genuinely distinct creative directions (spec section 10: "do not
 * generate four nearly identical prompts") — a fixed enum the concept
 * tool must pick from and can't repeat, so four concepts can never
 * collapse into four rewordings of the same mood board.
 */
export const STYLE_DIRECTIONS = ["cinematic", "luxury_editorial", "emotional_minimalist", "character_driven"] as const;
export type StyleDirection = (typeof STYLE_DIRECTIONS)[number];
export const STYLE_DIRECTION_LABELS: Record<StyleDirection, string> = {
  cinematic: "Cinematic",
  luxury_editorial: "Luxury Editorial",
  emotional_minimalist: "Emotional Minimalist",
  character_driven: "Character Driven",
};

export type DraftedConcept = { prompt: string; rationale: string; style_direction: StyleDirection };

function conceptsTool(count: number): ToolSpec {
  return {
    name: "generate_cover_concepts",
    description: `Generate ${count} genuinely distinct cover-art concept prompts for a book, suitable for an image-generation model.`,
    input_schema: {
      type: "object" as const,
      properties: {
        concepts: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: {
            type: "object",
            properties: {
              style_direction: { type: "string", enum: [...STYLE_DIRECTIONS], description: "Each concept in the array must use a DIFFERENT style_direction — never repeat one." },
              prompt: {
                type: "string",
                description:
                  "A detailed, concrete image-generation prompt: subject, mood, palette, composition, style. Leave deliberate negative space for " +
                  "typography — no important visual elements near the edges. Must describe wholly original artwork: never reference or imitate a " +
                  "specific living artist, and never describe reproducing another identifiable book's actual cover.",
              },
              rationale: { type: "string", description: "One sentence on why this direction fits the book's genre/audience/tone." },
            },
            required: ["style_direction", "prompt", "rationale"],
          },
        },
      },
      required: ["concepts"],
    },
  };
}

/**
 * Drafts N text concept prompts from the project's real CoverBrief
 * (research-aware when an accepted research report exists — see
 * lib/research-context.ts — but instructed to extract genre/audience
 * signals from it, never to copy a specific competitor's cover). Does
 * NOT generate any artwork itself — that's lib/cover-image-generation.ts,
 * called once per concept afterward, same "one unit of work" separation
 * as everywhere else in this app.
 */
export async function draftCoverConcepts(supabase: SupabaseClient, projectId: string, userId: string, count = 3): Promise<DraftedConcept[]> {
  const brief = await assembleCoverBrief(supabase, projectId);
  const facts = coverBriefToPromptFacts(brief).join("\n");

  const { output } = await generateStructured<{ concepts: DraftedConcept[] }>({
    system:
      "You are InkFrame's Cover Department, art-directing original book-cover artwork. Given the book's real " +
      "context below (including accepted research findings when present), extract genre conventions, audience " +
      "expectations, and differentiation opportunities — never copy a named competitor's actual cover, and " +
      "never imitate a specific living artist's style. Each concept must be a genuinely different creative " +
      "direction (see the required style_direction enum) — not the same mood reworded. Call the " +
      "generate_cover_concepts tool.",
    userContent: facts,
    tool: conceptsTool(count),
    maxTokens: 2000,
    preferredProvider: await resolvePreferredProviderForUser(supabase, userId),
  });

  return output.concepts;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPausedProjectIds } from "@/lib/production-paused";
import { generateStructured, type ToolSpec } from "@/lib/ai-client";

const COVER_TOOL: ToolSpec = {
  name: "generate_cover_concepts",
  description: "Generate 3 distinct cover-art concept prompts for a book, suitable for an image-generation model.",
  input_schema: {
    type: "object" as const,
    properties: {
      concepts: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "A detailed, concrete image-generation prompt: subject, mood, palette, composition, style." },
            rationale: { type: "string", description: "One sentence on why this direction fits the book." },
          },
          required: ["prompt", "rationale"],
        },
      },
    },
    required: ["concepts"],
  },
};

/**
 * Generates cover concept PROMPTS only — actually rendering artwork needs an
 * image-generation model, which is a different capability than the
 * text/tool-calling fallback chain here. Each concept is saved as
 * `proposed` with a null image_ref until that lands.
 */
export async function runCoverDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const pausedProjectIds = await getPausedProjectIds(supabase);

  let projectQuery = supabase.from("projects").select("id, book_type").eq("status", "GENERATING_COVER");
  if (pausedProjectIds.length > 0) {
    projectQuery = projectQuery.not("id", "in", `(${pausedProjectIds.join(",")})`);
  }
  const { data: project, error: projectQueryError } = await projectQuery
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);
  if (!project) return { processed: false, detail: "No projects awaiting a cover." };

  const { data: identity } = await supabase.from("project_identity").select("*").eq("project_id", project.id).single();

  const facts = [
    `Book type: ${project.book_type}`,
    identity?.working_title ? `Title: ${identity.working_title}` : null,
    identity?.subtitle ? `Subtitle: ${identity.subtitle}` : null,
    identity?.initial_idea ? `Idea: ${identity.initial_idea}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { output: result } = await generateStructured<{ concepts: { prompt: string; rationale: string }[] }>({
    system:
      "You are InkFrame's Cover Department. Propose 3 distinct, concrete cover-art concepts for this book " +
      "as image-generation prompts (subject, mood, palette, composition, style) — not vague mood words. " +
      "Call the generate_cover_concepts tool.",
    userContent: facts,
    tool: COVER_TOOL,
    maxTokens: 1500,
  });

  const concepts = result.concepts.map((c) => ({
    prompt: c.prompt,
    rationale: c.rationale,
    image_ref: null,
    status: "proposed" as const,
  }));

  const { error: upsertError } = await supabase
    .from("cover_department")
    .upsert(
      {
        project_id: project.id,
        input_snapshot: { title: identity?.working_title, subtitle: identity?.subtitle, book_type: project.book_type },
        concepts,
      },
      { onConflict: "project_id" }
    );
  if (upsertError) throw new Error(upsertError.message);

  await supabase.from("projects").update({ status: "GENERATING_METADATA" }).eq("id", project.id);

  return { processed: true, detail: `Project ${project.id}: cover concepts drafted, moved to GENERATING_METADATA.` };
}

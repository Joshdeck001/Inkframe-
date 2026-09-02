import type { SupabaseClient } from "@supabase/supabase-js";
import { getPausedProjectIds } from "@/lib/production-paused";
import { generateStructured, type ToolSpec } from "@/lib/ai-client";
import { generateImage } from "@/lib/image-client";

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

type Concept = {
  prompt: string;
  rationale: string;
  image_ref: string | null;
  status: "proposed" | "generated";
  // Bookkeeping, not part of the documented schema shape — same pattern as
  // translation-department.ts's _unitIndex. Marks a concept as attempted
  // (success or not) so a permanently-unavailable image provider (no
  // billing enabled, etc.) doesn't get retried forever.
  image_attempted?: boolean;
};

/**
 * One tick does ONE thing: either draft the 3 text concepts (first tick for
 * a project), or attempt real artwork for the next not-yet-attempted
 * concept — same "one unit of work per tick" shape as every other
 * department. Real image generation needs OPENAI_API_KEY or
 * GEMINI_API_KEY with billing enabled on that provider (Claude has no
 * image-generation capability at all); if neither succeeds, the concept
 * stays exactly what it's always been — a real prompt with no image yet,
 * never a fabricated one.
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

  const { data: coverRow } = await supabase
    .from("cover_department")
    .select("concepts")
    .eq("project_id", project.id)
    .maybeSingle();

  if (!coverRow || !Array.isArray(coverRow.concepts) || coverRow.concepts.length === 0) {
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

    const concepts: Concept[] = result.concepts.map((c) => ({
      prompt: c.prompt,
      rationale: c.rationale,
      image_ref: null,
      status: "proposed",
      image_attempted: false,
    }));

    const { error: upsertError } = await supabase.from("cover_department").upsert(
      {
        project_id: project.id,
        input_snapshot: { title: identity?.working_title, subtitle: identity?.subtitle, book_type: project.book_type },
        concepts,
      },
      { onConflict: "project_id" }
    );
    if (upsertError) throw new Error(upsertError.message);

    return { processed: true, detail: `Project ${project.id}: 3 cover concepts drafted, generating artwork next.` };
  }

  const concepts = coverRow.concepts as Concept[];
  const nextIndex = concepts.findIndex((c) => !c.image_attempted);

  if (nextIndex === -1) {
    await supabase.from("projects").update({ status: "GENERATING_IMAGES" }).eq("id", project.id);
    const generatedCount = concepts.filter((c) => c.status === "generated").length;
    return {
      processed: true,
      detail: `Project ${project.id}: cover artwork attempts complete (${generatedCount}/${concepts.length} real images), moved to GENERATING_IMAGES.`,
    };
  }

  const concept = concepts[nextIndex];
  try {
    const image = await generateImage({ prompt: concept.prompt });
    const path = `${project.id}/concept-${nextIndex + 1}.png`;
    const { error: uploadError } = await supabase.storage
      .from("covers")
      .upload(path, image.buffer, { contentType: image.mimeType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);
    const {
      data: { publicUrl },
    } = supabase.storage.from("covers").getPublicUrl(path);

    concepts[nextIndex] = { ...concept, image_ref: publicUrl, status: "generated", image_attempted: true };
    await supabase.from("cover_department").update({ concepts }).eq("project_id", project.id);
    return {
      processed: true,
      detail: `Project ${project.id}: generated real artwork for concept ${nextIndex + 1}/${concepts.length} (${image.provider}:${image.model}).`,
    };
  } catch (e) {
    concepts[nextIndex] = { ...concept, image_attempted: true };
    await supabase.from("cover_department").update({ concepts }).eq("project_id", project.id);
    return {
      processed: true,
      detail: `Project ${project.id}: concept ${nextIndex + 1}/${concepts.length} stays a prompt only — image generation unavailable (${
        e instanceof Error ? e.message : String(e)
      }).`,
    };
  }
}

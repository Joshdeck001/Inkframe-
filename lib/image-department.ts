import type { SupabaseClient } from "@supabase/supabase-js";
import { getPausedProjectIds } from "@/lib/production-paused";
import { generateStructured, type ToolSpec } from "@/lib/ai-client";
import { generateImage } from "@/lib/image-client";

const PLACEMENT_TOOL: ToolSpec = {
  name: "propose_image_placements",
  description:
    "Decide which chapters of this book would genuinely benefit from one interior illustration each, and " +
    "write a concrete image-generation prompt for each. It's fine to propose zero — most chapters don't need one.",
  input_schema: {
    type: "object" as const,
    properties: {
      placements: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            chapter_number: { type: "integer", description: "Which chapter this image belongs to." },
            placement_location: {
              type: "string",
              description: "Where in the chapter, e.g. 'chapter opening' or 'after the confrontation scene'.",
            },
            prompt: {
              type: "string",
              description: "A detailed, concrete image-generation prompt: subject, mood, palette, composition, style.",
            },
          },
          required: ["chapter_number", "placement_location", "prompt"],
        },
      },
    },
    required: ["placements"],
  },
};

type Placement = {
  id: string;
  chapter_id: string | null;
  placement_location: string | null;
  prompt: string | null;
  status: "proposed" | "approved" | "rejected" | "generated" | "uploaded";
  file_ref: string | null;
  image_attempted: boolean;
};

/**
 * Interior/in-manuscript images — a separate, later-arriving feature from
 * cover art. Same two-phase, one-unit-per-tick shape as
 * cover-department.ts: the first tick for a project decides WHICH
 * chapters get an image and writes a prompt for each (or decides none are
 * needed), later ticks attempt real artwork for one not-yet-attempted
 * placement at a time. Only runs at all when the wizard's Step 7
 * (project_images) asked for it — "No Images" and "User Upload" skip
 * straight through untouched, and "Generate Automatically"/"Mixed" only
 * run when the user also said yes to auto-placement recommendations.
 */
export async function runImageDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const pausedProjectIds = await getPausedProjectIds(supabase);

  let projectQuery = supabase.from("projects").select("id").eq("status", "GENERATING_IMAGES");
  if (pausedProjectIds.length > 0) {
    projectQuery = projectQuery.not("id", "in", `(${pausedProjectIds.join(",")})`);
  }
  const { data: project, error: projectQueryError } = await projectQuery
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);
  if (!project) return { processed: false, detail: "No projects awaiting interior images." };

  const { data: imagesConfig } = await supabase
    .from("project_images")
    .select("image_workflow, auto_placement_enabled")
    .eq("project_id", project.id)
    .maybeSingle();

  const wantsAutoImages =
    (imagesConfig?.image_workflow === "Generate Automatically" || imagesConfig?.image_workflow === "Mixed") &&
    imagesConfig?.auto_placement_enabled === true;

  if (!wantsAutoImages) {
    await supabase.from("projects").update({ status: "GENERATING_METADATA" }).eq("id", project.id);
    return {
      processed: true,
      detail: `Project ${project.id}: no interior-image auto-placement requested, moved to GENERATING_METADATA.`,
    };
  }

  const { data: existingPlacements } = await supabase
    .from("image_placements")
    .select("id, chapter_id, placement_location, prompt, status, file_ref, image_attempted")
    .eq("project_id", project.id);

  if (!existingPlacements || existingPlacements.length === 0) {
    const { data: chapters } = await supabase
      .from("chapters")
      .select("id, chapter_number, title, objective")
      .eq("project_id", project.id)
      .order("chapter_number", { ascending: true });

    const chapterList = chapters ?? [];
    const facts = chapterList.map((c) => `${c.chapter_number}. ${c.title} — ${c.objective}`).join("\n");

    const { output: result } = await generateStructured<{
      placements: { chapter_number: number; placement_location: string; prompt: string }[];
    }>({
      system:
        "You are InkFrame's Image Department. Given this book's chapter list, decide which chapters would " +
        "genuinely benefit from one interior illustration each (most books need very few — propose zero if " +
        "none would add real value) and write a concrete image-generation prompt for each: subject, mood, " +
        "palette, composition, style. Call the propose_image_placements tool.",
      userContent: facts || "No chapters found.",
      tool: PLACEMENT_TOOL,
      maxTokens: 1500,
    });

    const chapterIdByNumber = new Map(chapterList.map((c) => [c.chapter_number, c.id]));
    const rows = result.placements
      .filter((p) => chapterIdByNumber.has(p.chapter_number))
      .map((p) => ({
        project_id: project.id,
        chapter_id: chapterIdByNumber.get(p.chapter_number)!,
        placement_location: p.placement_location,
        prompt: p.prompt,
        status: "proposed" as const,
        image_attempted: false,
      }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("image_placements").insert(rows);
      if (insertError) throw new Error(insertError.message);
      return {
        processed: true,
        detail: `Project ${project.id}: proposed ${rows.length} interior-image placement(s), generating artwork next.`,
      };
    }

    await supabase.from("projects").update({ status: "GENERATING_METADATA" }).eq("id", project.id);
    return {
      processed: true,
      detail: `Project ${project.id}: no chapters needed an interior image, moved to GENERATING_METADATA.`,
    };
  }

  const placements = existingPlacements as Placement[];
  const next = placements.find((p) => !p.image_attempted);

  if (!next) {
    await supabase.from("projects").update({ status: "GENERATING_METADATA" }).eq("id", project.id);
    const generatedCount = placements.filter((p) => p.status === "generated").length;
    return {
      processed: true,
      detail: `Project ${project.id}: interior-image attempts complete (${generatedCount}/${placements.length} real images), moved to GENERATING_METADATA.`,
    };
  }

  if (!next.prompt) {
    await supabase.from("image_placements").update({ image_attempted: true }).eq("id", next.id);
    return { processed: true, detail: `Project ${project.id}: placement ${next.id} had no prompt, skipped.` };
  }

  try {
    const image = await generateImage({ prompt: next.prompt });
    const path = `${project.id}/${next.id}.png`;
    const { error: uploadError } = await supabase.storage
      .from("manuscript-images")
      .upload(path, image.buffer, { contentType: image.mimeType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);
    const {
      data: { publicUrl },
    } = supabase.storage.from("manuscript-images").getPublicUrl(path);

    await supabase
      .from("image_placements")
      .update({ file_ref: publicUrl, status: "generated", image_attempted: true })
      .eq("id", next.id);
    return {
      processed: true,
      detail: `Project ${project.id}: generated real artwork for placement ${next.id} (${image.provider}:${image.model}).`,
    };
  } catch (e) {
    await supabase.from("image_placements").update({ image_attempted: true }).eq("id", next.id);
    return {
      processed: true,
      detail: `Project ${project.id}: placement ${next.id} stays a prompt only — image generation unavailable (${
        e instanceof Error ? e.message : String(e)
      }).`,
    };
  }
}

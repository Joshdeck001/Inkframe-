import type { SupabaseClient } from "@supabase/supabase-js";
import { getPausedProjectIds } from "@/lib/production-paused";
import { draftCoverConcepts, type StyleDirection } from "@/lib/cover-concepts";
import { generateCoverArt } from "@/lib/cover-image-generation";

export type Concept = {
  prompt: string;
  rationale: string;
  style_direction?: StyleDirection;
  image_ref: string | null;
  status: "proposed" | "generated";
  // Bookkeeping, not part of the documented schema shape — same pattern as
  // translation-department.ts's _unitIndex. Marks a concept as attempted
  // (success or not) so a permanently-unavailable image provider (no
  // billing enabled, etc.) doesn't get retried forever.
  image_attempted?: boolean;
  // Version history (spec: never delete a previous concept when generating
  // a new one). version is 1-based and unique within the array; a concept
  // created by editing/regenerating another carries that concept's version
  // as parent_version, so lineage is never lost.
  version: number;
  parent_version: number | null;
  source: "generated" | "edited" | "user_uploaded";
  selected?: boolean;
  reference_image_ref?: string | null;
  edit_instructions?: string | null;
};

/**
 * One tick does ONE thing: either draft the first 3 text concepts (first
 * tick for a project) via lib/cover-concepts.ts's CoverBrief-grounded
 * drafting, or attempt real artwork for the next not-yet-attempted
 * concept via lib/cover-image-generation.ts — same "one unit of work per
 * tick" shape as every other department. Real image generation needs
 * OPENAI_API_KEY or GEMINI_API_KEY with billing enabled on that provider
 * (Claude has no image-generation capability at all); if neither
 * succeeds, the concept stays exactly what it's always been — a real
 * prompt with no image yet, never a fabricated one. Also picks up
 * manually-added concepts (see /api/cover/generate-concepts) that were
 * appended with image_attempted: false, so "Generate More Concepts"
 * reuses this exact same tick instead of a second job mechanism.
 */
export async function runCoverDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const pausedProjectIds = await getPausedProjectIds(supabase);

  let projectQuery = supabase.from("projects").select("id, user_id, book_type, status").eq("status", "GENERATING_COVER");
  if (pausedProjectIds.length > 0) {
    projectQuery = projectQuery.not("id", "in", `(${pausedProjectIds.join(",")})`);
  }
  const { data: project, error: projectQueryError } = await projectQuery
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);

  // Automatic pipeline projects take priority, but a manual "Generate
  // More Concepts" request (any project with pending artwork regardless
  // of pipeline status — see /api/cover/generate-concepts) still needs a
  // tick to actually render it, so fall back to scanning for those.
  const activeProject = project ?? (await findProjectWithPendingConceptArt(supabase, pausedProjectIds));
  if (!activeProject) return { processed: false, detail: "No projects awaiting a cover." };

  const { data: coverRow } = await supabase
    .from("cover_department")
    .select("concepts")
    .eq("project_id", activeProject.id)
    .maybeSingle();

  if (!coverRow || !Array.isArray(coverRow.concepts) || coverRow.concepts.length === 0) {
    const drafted = await draftCoverConcepts(supabase, activeProject.id, activeProject.user_id, 3);
    const concepts: Concept[] = drafted.map((c, i) => ({
      prompt: c.prompt,
      rationale: c.rationale,
      style_direction: c.style_direction,
      image_ref: null,
      status: "proposed",
      image_attempted: false,
      version: i + 1,
      parent_version: null,
      source: "generated",
    }));

    const { error: upsertError } = await supabase.from("cover_department").upsert(
      { project_id: activeProject.id, concepts },
      { onConflict: "project_id" }
    );
    if (upsertError) throw new Error(upsertError.message);

    return { processed: true, detail: `Project ${activeProject.id}: 3 cover concepts drafted, generating artwork next.` };
  }

  const concepts = coverRow.concepts as Concept[];
  const nextIndex = concepts.findIndex((c) => !c.image_attempted);

  if (nextIndex === -1) {
    if (activeProject.status === "GENERATING_COVER") {
      await supabase.from("projects").update({ status: "GENERATING_IMAGES" }).eq("id", activeProject.id);
    }
    const generatedCount = concepts.filter((c) => c.status === "generated").length;
    return {
      processed: true,
      detail: `Project ${activeProject.id}: cover artwork attempts complete (${generatedCount}/${concepts.length} real images).`,
    };
  }

  const concept = concepts[nextIndex];
  try {
    // JPEG for the ebook cover — the format Amazon KDP and other ebook
    // platforms actually expect for a cover upload, not the PNG every other
    // generated image on this app uses.
    const image = await generateCoverArt(
      supabase,
      { projectId: activeProject.id, userId: activeProject.user_id },
      { prompt: concept.prompt, format: "jpeg" }
    );
    const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
    const path = `${activeProject.id}/concept-v${concept.version}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("covers")
      .upload(path, image.buffer, { contentType: image.mimeType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);
    const {
      data: { publicUrl },
    } = supabase.storage.from("covers").getPublicUrl(path);

    concepts[nextIndex] = { ...concept, image_ref: publicUrl, status: "generated", image_attempted: true };
    await supabase.from("cover_department").update({ concepts }).eq("project_id", activeProject.id);
    return {
      processed: true,
      detail: `Project ${activeProject.id}: generated real artwork for concept v${concept.version} (${image.provider}:${image.model}).`,
    };
  } catch (e) {
    concepts[nextIndex] = { ...concept, image_attempted: true };
    await supabase.from("cover_department").update({ concepts }).eq("project_id", activeProject.id);
    return {
      processed: true,
      detail: `Project ${activeProject.id}: concept v${concept.version} stays a prompt only — image generation unavailable (${
        e instanceof Error ? e.message : String(e)
      }).`,
    };
  }
}

async function findProjectWithPendingConceptArt(
  supabase: SupabaseClient,
  pausedProjectIds: string[]
): Promise<{ id: string; user_id: string; book_type: string; status: string } | null> {
  let query = supabase.from("cover_department").select("project_id, concepts, projects!inner(id, user_id, book_type, status)").neq("projects.status", "GENERATING_COVER");
  const { data } = await query.limit(50);
  for (const row of data ?? []) {
    const concepts = (row.concepts as Concept[] | null) ?? [];
    if (concepts.some((c) => !c.image_attempted) && !pausedProjectIds.includes(row.project_id)) {
      const p = row.projects as any;
      return { id: p.id, user_id: p.user_id, book_type: p.book_type, status: p.status };
    }
  }
  return null;
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { editCoverArt } from "@/lib/cover-image-generation";
import type { Concept } from "@/lib/cover-department";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const QUALITIES = ["low", "medium", "high", "auto"];

/**
 * Real OpenAI image editing (spec section 11): edit an existing concept's
 * artwork, generate using an uploaded reference image, or both together.
 * Always creates a NEW concept version — the source concept's image_ref
 * and every prior version stay in the array untouched (spec section 28:
 * never destroy user work). At least one input image is required, since
 * the edit endpoint has nothing to edit otherwise.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { project_id, instructions, base_concept_version, reference_image_path, quality } = await request.json();
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (typeof instructions !== "string" || !instructions.trim()) return NextResponse.json({ error: "instructions is required" }, { status: 400 });
  if (!base_concept_version && !reference_image_path) {
    return NextResponse.json({ error: "Provide base_concept_version (edit an existing concept) and/or reference_image_path (use an uploaded reference)." }, { status: 400 });
  }
  if (quality && !QUALITIES.includes(quality)) return NextResponse.json({ error: `quality must be one of: ${QUALITIES.join(", ")}` }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: project } = await supabase.from("projects").select("id, user_id").eq("id", project_id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: coverRow } = await supabase.from("cover_department").select("concepts").eq("project_id", project_id).maybeSingle();
  const concepts = ((coverRow?.concepts as Concept[] | null) ?? []);

  let baseConcept: Concept | null = null;
  if (base_concept_version) {
    baseConcept = concepts.find((c) => c.version === base_concept_version) ?? null;
    if (!baseConcept?.image_ref) return NextResponse.json({ error: "That concept has no generated artwork to edit yet." }, { status: 400 });
  }

  const service = createServiceClient();
  const images: { buffer: Buffer; mimeType: string }[] = [];
  try {
    if (baseConcept?.image_ref) {
      const res = await fetch(baseConcept.image_ref);
      if (!res.ok) throw new Error(`Could not fetch the concept's existing artwork (HTTP ${res.status}).`);
      images.push({ buffer: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") || "image/jpeg" });
    }
    if (reference_image_path) {
      const { data: blob, error } = await service.storage.from("cover-references").download(reference_image_path);
      if (error || !blob) throw new Error("Could not read the uploaded reference image.");
      images.push({ buffer: Buffer.from(await blob.arrayBuffer()), mimeType: blob.type || "image/png" });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load the input image(s)." }, { status: 502 });
  }

  let result;
  try {
    result = await editCoverArt(
      supabase,
      { projectId: project_id, userId: project.user_id },
      { prompt: instructions, images, quality, format: "jpeg" }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI cover editing failed." }, { status: 502 });
  }

  const maxVersion = concepts.reduce((max, c) => Math.max(max, c.version ?? 0), 0);
  const newVersion = maxVersion + 1;
  const path = `${project_id}/concept-v${newVersion}.jpg`;
  const { error: uploadError } = await service.storage.from("covers").upload(path, result.buffer, { contentType: result.mimeType, upsert: true });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });
  const {
    data: { publicUrl },
  } = service.storage.from("covers").getPublicUrl(path);

  const newConcept: Concept = {
    prompt: baseConcept?.prompt ?? instructions,
    rationale: baseConcept ? `Edited from concept v${baseConcept.version}: ${instructions}` : `Generated from a reference image: ${instructions}`,
    style_direction: baseConcept?.style_direction,
    image_ref: publicUrl,
    status: "generated",
    image_attempted: true,
    version: newVersion,
    parent_version: baseConcept?.version ?? null,
    source: "edited",
    reference_image_ref: reference_image_path || null,
    edit_instructions: instructions,
  };

  const { error: saveError } = await supabase
    .from("cover_department")
    .upsert({ project_id, concepts: [...concepts, newConcept] }, { onConflict: "project_id" });
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  await supabase.from("publishing_log").insert({ project_id, event: `Cover concept v${newVersion} created via AI edit.` });

  return NextResponse.json({ version: newVersion, image_ref: publicUrl });
});

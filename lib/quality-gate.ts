import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Final Quality Gate — a deterministic summary of everything Steps 5-9
 * already produced, not a new judgment call. `overall_readiness_score` is
 * explicitly an internal assessment (0-100), never a guarantee of platform
 * acceptance. Continuity currently only checks for gaps in chapter
 * numbering — the real story_bible-driven Continuity Engine isn't built
 * yet, so this is a structural proxy, not semantic continuity checking.
 */
export async function computeQualityGate(supabase: SupabaseClient, projectId: string) {
  const [
    { data: project },
    { data: scope },
    { data: chapters },
    { data: blueprint },
    { data: metadata },
    { data: cover },
    { data: complianceChecks },
    { data: formattingJob },
    { data: images },
  ] = await Promise.all([
    supabase.from("projects").select("id").eq("id", projectId).single(),
    supabase.from("project_scope").select("target_word_count").eq("project_id", projectId).single(),
    supabase.from("chapters").select("chapter_number, status, actual_words").eq("project_id", projectId).order("chapter_number", { ascending: true }),
    supabase.from("book_blueprint").select("structure").eq("project_id", projectId).eq("approval_status", "approved").order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("metadata_department").select("keywords").eq("project_id", projectId).maybeSingle(),
    supabase.from("cover_department").select("concepts").eq("project_id", projectId).maybeSingle(),
    supabase.from("compliance_checks").select("check_type, status").eq("project_id", projectId),
    supabase.from("formatting_jobs").select("status").eq("project_id", projectId).eq("status", "complete").limit(1).maybeSingle(),
    supabase.from("project_images").select("image_workflow").eq("project_id", projectId).maybeSingle(),
  ]);

  if (!project) throw new Error("Project not found");

  const chapterList = chapters ?? [];
  const contentCheck = chapterList.length > 0 && chapterList.every((c) => c.status === "approved");

  const blueprintChapterCount = blueprint
    ? (blueprint.structure as { parts: { chapters: unknown[] }[] }).parts.reduce((s, p) => s + p.chapters.length, 0)
    : 0;
  const structureCheck = blueprintChapterCount > 0 && chapterList.length === blueprintChapterCount;

  const continuityCheck = chapterList.every((c, i) => c.chapter_number === i + 1);

  const totalWords = chapterList.reduce((s, c) => s + (c.actual_words || 0), 0);
  const target = scope?.target_word_count ?? 0;
  const wordCountCheck = target === 0 || (totalWords >= target * 0.8 && totalWords <= target * 1.2);

  const imagesCheck: "pass" | "not_required" =
    images?.image_workflow === "No Images" ? "not_required" : (cover?.concepts?.length ?? 0) > 0 ? "pass" : "not_required";

  const metadataCheck = (metadata?.keywords?.length ?? 0) === 7;

  // AI-disclosure and "no cover artwork yet" are expected, always-present
  // flags at this stage of the product, not gate blockers — only an
  // unresolved metadata/title issue should fail platform_check.
  const blockingCompliance = (complianceChecks ?? []).some(
    (c) => ["metadata", "title_subtitle"].includes(c.check_type) && ["action_required", "human_review_required"].includes(c.status)
  );
  const platformCheck = !blockingCompliance;

  const formattingCheck = !!formattingJob;
  const coverCheck = (cover?.concepts?.length ?? 0) > 0;

  const checks = [contentCheck, structureCheck, continuityCheck, wordCountCheck, metadataCheck, platformCheck, formattingCheck, coverCheck];
  const overallReadinessScore = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  const gate = {
    project_id: projectId,
    content_check: contentCheck,
    structure_check: structureCheck,
    continuity_check: continuityCheck,
    word_count_check: wordCountCheck,
    images_check: imagesCheck,
    metadata_check: metadataCheck,
    platform_check: platformCheck,
    formatting_check: formattingCheck,
    cover_check: coverCheck,
    overall_readiness_score: overallReadinessScore,
  };

  const { error } = await supabase.from("quality_gate").upsert(gate, { onConflict: "project_id" });
  if (error) throw new Error(error.message);

  return gate;
}

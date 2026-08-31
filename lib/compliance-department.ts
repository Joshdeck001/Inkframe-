import type { SupabaseClient } from "@supabase/supabase-js";

type ComplianceCheck = {
  project_id: string;
  platform_profile_id: string | null;
  check_type:
    | "metadata"
    | "title_subtitle"
    | "content_restrictions"
    | "formatting"
    | "images"
    | "submission"
    | "ai_disclosure"
    | "ip_risk"
    | "missing_info";
  status: "pass" | "warning" | "action_required" | "human_review_required";
  detail: string;
};

/**
 * Deterministic rule checks against the already-seeded platform_profiles
 * data (KDP/GoodNovel/Meganovel) — no LLM call needed, which makes this
 * department both cheaper and more trustworthy than a generative pass.
 * Display language throughout: "Passed InkFrame's current platform checks"
 * — never "guaranteed platform approval".
 */
export async function runComplianceDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const { data: project, error: projectQueryError } = await supabase
    .from("projects")
    .select("id")
    .eq("status", "COMPLIANCE_CHECK")
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);
  if (!project) return { processed: false, detail: "No projects awaiting compliance checks." };

  const [{ data: identity }, { data: platform }, { data: metadata }, { data: chapters }, { data: titleRisks }] =
    await Promise.all([
      supabase.from("project_identity").select("*").eq("project_id", project.id).single(),
      supabase.from("project_platform").select("*").eq("project_id", project.id).single(),
      supabase.from("metadata_department").select("*").eq("project_id", project.id).maybeSingle(),
      supabase.from("chapters").select("actual_words").eq("project_id", project.id),
      supabase
        .from("title_risk_checks")
        .select("status")
        .eq("project_id", project.id)
        .order("checked_at", { ascending: false })
        .limit(1),
    ]);

  let platformProfile: { platform_name: string; metadata_rules: Record<string, unknown>; contract_submission_rules: Record<string, unknown> } | null = null;
  if (platform?.platform_profile_id) {
    const { data } = await supabase
      .from("platform_profiles")
      .select("platform_name, metadata_rules, contract_submission_rules")
      .eq("id", platform.platform_profile_id)
      .maybeSingle();
    platformProfile = data;
  }

  const checks: ComplianceCheck[] = [];
  const platformProfileId = platform?.platform_profile_id ?? null;

  // AI disclosure — every InkFrame manuscript is AI-generated content.
  checks.push({
    project_id: project.id,
    platform_profile_id: platformProfileId,
    check_type: "ai_disclosure",
    status: "action_required",
    detail:
      "This manuscript was AI-generated. Most platforms (Amazon KDP included) require disclosure for " +
      "AI-generated content — not just AI-assisted — during upload. Keep your own record of prompts/edits " +
      "if a meaningful share of the text is your own substantial rewrite instead.",
  });

  // Metadata: keyword count/length, no repeated title/subtitle words.
  if (metadata) {
    const issues: string[] = [];
    if (metadata.keywords.length !== 7) issues.push(`${metadata.keywords.length}/7 keyword slots filled`);
    const tooLong = metadata.keywords.filter((k: string) => k.length > 50);
    if (tooLong.length > 0) issues.push(`${tooLong.length} keyword(s) over 50 characters`);
    const titleWords = new Set(
      `${identity?.working_title ?? ""} ${identity?.subtitle ?? ""}`.toLowerCase().split(/\W+/).filter(Boolean)
    );
    const repeated = metadata.keywords.filter((k: string) =>
      k.toLowerCase().split(/\W+/).some((w) => titleWords.has(w) && w.length > 3)
    );
    if (repeated.length > 0) issues.push(`${repeated.length} keyword(s) repeat words already in the title/subtitle`);

    checks.push({
      project_id: project.id,
      platform_profile_id: platformProfileId,
      check_type: "metadata",
      status: issues.length === 0 ? "pass" : "warning",
      detail:
        issues.length === 0
          ? "Passed InkFrame's current metadata checks — 7 keyword slots, all within 50 characters, no repeated title/subtitle words."
          : `Metadata needs a look: ${issues.join("; ")}.`,
    });
  } else {
    checks.push({
      project_id: project.id,
      platform_profile_id: platformProfileId,
      check_type: "missing_info",
      status: "action_required",
      detail: "No metadata has been generated for this project yet.",
    });
  }

  // Title/subtitle risk, from the most recent title_risk_checks row.
  const latestRisk = titleRisks?.[0]?.status;
  checks.push({
    project_id: project.id,
    platform_profile_id: platformProfileId,
    check_type: "title_subtitle",
    status: !latestRisk ? "human_review_required" : latestRisk === "no_issue" ? "pass" : "human_review_required",
    detail: !latestRisk
      ? "No title risk check has been run yet."
      : latestRisk === "no_issue"
      ? "Passed InkFrame's current title risk check — no significant issue detected. This is a risk flag, not a legal guarantee."
      : `Title risk check flagged: ${latestRisk.replace(/_/g, " ")}. Review before publishing.`,
  });

  // Chapter length, for serial/contract platforms with a documented guideline.
  if (platformProfile && chapters && chapters.length > 0) {
    const rules = platformProfile.contract_submission_rules as { chapter_length_guideline_words?: string } | undefined;
    const avgWords = chapters.reduce((s: number, c: { actual_words: number }) => s + (c.actual_words || 0), 0) / chapters.length;
    if (rules?.chapter_length_guideline_words) {
      checks.push({
        project_id: project.id,
        platform_profile_id: platformProfileId,
        check_type: "formatting",
        status: "pass",
        detail: `Average chapter length is ${Math.round(avgWords)} words. ${platformProfile.platform_name}'s guideline: ${rules.chapter_length_guideline_words}. Soft guideline — not a hard rule.`,
      });
    }
  }

  // Cover — not generated as real artwork yet (Cover Department only produces prompts so far).
  checks.push({
    project_id: project.id,
    platform_profile_id: platformProfileId,
    check_type: "images",
    status: "human_review_required",
    detail: "Cover concepts have been drafted as prompts, but no artwork has been generated yet — review once a cover image exists.",
  });

  const { error: insertError } = await supabase.from("compliance_checks").insert(checks);
  if (insertError) throw new Error(insertError.message);

  await supabase.from("projects").update({ status: "FORMATTING" }).eq("id", project.id);

  return { processed: true, detail: `Project ${project.id}: ${checks.length} compliance checks recorded, moved to FORMATTING.` };
}

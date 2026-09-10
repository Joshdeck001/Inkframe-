import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

const PLATFORMS = ["Amazon KDP", "Kobo", "Google Play Books", "Apple Books", "Other"];
const FORMATS = ["ebook", "paperback", "hardcover"];

/**
 * The explicit human-approval gate for background KDP preparation (spec:
 * critical operations require explicit user approval, same convention as
 * /api/audiobook/start) — preparation never starts on its own. Reuses the
 * existing publishing_jobs row for this project+platform (unique since
 * migration 0004) instead of creating a second job record: an active run
 * is returned as-is (idempotent — spec: don't create duplicate jobs on a
 * double click), otherwise the row is reset to 'queued' so
 * lib/kdp-preparation-department.ts picks it up on the next tick.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { project_id, target_platform, requested_formats } = await request.json();
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (!PLATFORMS.includes(target_platform)) {
    return NextResponse.json({ error: `target_platform must be one of: ${PLATFORMS.join(", ")}` }, { status: 400 });
  }
  if (!Array.isArray(requested_formats) || requested_formats.length === 0 || !requested_formats.every((f) => FORMATS.includes(f))) {
    return NextResponse.json({ error: `requested_formats must be a non-empty subset of: ${FORMATS.join(", ")}` }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: project } = await supabase.from("projects").select("id").eq("id", project_id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: existing } = await supabase
    .from("publishing_jobs")
    .select("id, status")
    .eq("project_id", project_id)
    .eq("target_platform", target_platform)
    .maybeSingle();

  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return NextResponse.json({ job_id: existing.id, status: existing.status, already_running: true });
  }

  const { data: job, error } = await supabase
    .from("publishing_jobs")
    .upsert(
      {
        project_id,
        target_platform,
        requested_formats,
        status: "queued",
        stages: [],
        blockers: [],
        package_ref: null,
        error: null,
        started_at: null,
        prepared_at: null,
      },
      { onConflict: "project_id,target_platform" }
    )
    .select("id, status")
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message || "Could not start KDP preparation." }, { status: 500 });

  await supabase.from("publishing_log").insert({
    project_id,
    event: `KDP preparation started for ${target_platform} (${requested_formats.join(", ")}).`,
  });

  return NextResponse.json({ job_id: job.id, status: job.status, already_running: false });
});

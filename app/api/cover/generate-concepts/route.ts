import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { draftCoverConcepts } from "@/lib/cover-concepts";
import type { Concept } from "@/lib/cover-department";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The explicit human-approval gate for "Generate More Concepts" — text
 * drafting happens synchronously here (fast, one AI call), but the
 * actual artwork is deliberately NOT generated in this request. New
 * concept rows are appended with image_attempted: false and the
 * existing lib/cover-department.ts tick (already running on the shared
 * cron schedule) picks them up and renders them one at a time in the
 * background — the same job mechanism the automatic pipeline uses, not
 * a second one, so the user can start this and leave (spec section 21).
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { project_id, count } = await request.json();
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const requestedCount = Number.isInteger(count) && count > 0 && count <= 6 ? count : 4;

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: project } = await supabase.from("projects").select("id, user_id").eq("id", project_id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: existing } = await supabase.from("cover_department").select("concepts").eq("project_id", project_id).maybeSingle();
  const existingConcepts = ((existing?.concepts as Concept[] | null) ?? []);
  const maxVersion = existingConcepts.reduce((max, c) => Math.max(max, c.version ?? 0), 0);

  let drafted;
  try {
    drafted = await draftCoverConcepts(supabase, project_id, project.user_id, requestedCount);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not draft new cover concepts." }, { status: 502 });
  }

  const newConcepts: Concept[] = drafted.map((c, i) => ({
    prompt: c.prompt,
    rationale: c.rationale,
    style_direction: c.style_direction,
    image_ref: null,
    status: "proposed",
    image_attempted: false,
    version: maxVersion + i + 1,
    parent_version: null,
    source: "generated",
  }));

  const { error: upsertError } = await supabase
    .from("cover_department")
    .upsert({ project_id, concepts: [...existingConcepts, ...newConcepts] }, { onConflict: "project_id" });
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  await supabase.from("publishing_log").insert({
    project_id,
    event: `${newConcepts.length} new cover concept(s) queued for AI artwork generation.`,
  });

  return NextResponse.json({ queued: newConcepts.length, versions: newConcepts.map((c) => c.version) });
});

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

const REFORMATTABLE_STATUSES = ["READY_FOR_REVIEW", "USER_APPROVED", "READY_FOR_EXPORT", "EXPORTED"];

/**
 * Re-runs the Formatting Department for a book that already has a finished
 * manuscript, without touching chapters or the blueprint — for when a
 * formatting/rendering fix ships (e.g. inline Markdown emphasis markers
 * that used to show up literally in the exported file) and an
 * already-generated book needs its DOCX/EPUB rebuilt from the same content
 * to actually pick it up, rather than the author re-writing anything.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { project_id } = await request.json();
  if (!project_id) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: project } = await supabase.from("projects").select("id, status").eq("id", project_id).maybeSingle();
  if (!project) {
    // RLS silently returns no row for a project this user doesn't own — treat both the same.
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!REFORMATTABLE_STATUSES.includes(project.status)) {
    return NextResponse.json(
      { error: "This book hasn't finished its manuscript yet — nothing to re-export." },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase.from("projects").update({ status: "FORMATTING" }).eq("id", project_id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});

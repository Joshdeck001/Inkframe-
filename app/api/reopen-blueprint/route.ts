import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

const NOT_REOPENABLE_STATUSES = ["IDEA", "BLUEPRINT", "AWAITING_APPROVAL", "EXPORTED"];

/**
 * Lets the author pull an already-approved (and possibly already-writing)
 * project back into the wizard's blueprint review step — e.g. to fix a
 * chapter count the first blueprint didn't actually honor. Deliberately
 * destructive to `chapters`: whatever's been drafted so far no longer
 * matches the structure they're about to redefine, so it's wiped rather
 * than left as orphaned rows the Writing Agent would never revisit. The
 * existing `book_blueprint` row is left alone — the wizard shows it as the
 * starting point to edit/regenerate from, not thrown away.
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
  if (NOT_REOPENABLE_STATUSES.includes(project.status)) {
    return NextResponse.json(
      {
        error:
          project.status === "EXPORTED"
            ? "This book has already been exported and can't be restructured from here."
            : "This book hasn't started writing yet — use the wizard directly instead.",
      },
      { status: 400 }
    );
  }

  const { error: deleteError } = await supabase.from("chapters").delete().eq("project_id", project_id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  const [{ error: scopeError }, { error: projectError }] = await Promise.all([
    supabase.from("project_scope").update({ words_written: 0 }).eq("project_id", project_id),
    supabase.from("projects").update({ status: "AWAITING_APPROVAL" }).eq("id", project_id),
  ]);
  if (scopeError) return NextResponse.json({ error: scopeError.message }, { status: 500 });
  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});

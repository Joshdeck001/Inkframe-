import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { runTitleAndCategoryResearch } from "@/lib/research-check";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const POST = withJsonErrors(async (request: Request) => {
  const { project_id } = await request.json();
  if (!project_id) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: authError }, { status: authStatus });
  }

  const { data: project } = await supabase.from("projects").select("id").eq("id", project_id).maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const result = await runTitleAndCategoryResearch(supabase, project_id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Research did not return structured output." },
      { status: 502 }
    );
  }
});

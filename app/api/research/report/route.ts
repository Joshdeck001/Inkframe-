import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { generateResearchReport } from "@/lib/research-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Generates a research report strictly from the project's own evidence
 * (competitor/keyword/category rows the author entered, plus a live web
 * search only if a provider is actually configured) and saves it as a
 * new 'draft' research_reports row — never overwrites a prior report, so
 * the author can compare versions as more evidence gets added over time.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { project_id, session_id } = await request.json();
  if (!project_id && !session_id) return NextResponse.json({ error: "project_id or session_id is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  if (project_id) {
    const { data: project } = await supabase.from("projects").select("id").eq("id", project_id).maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (session_id) {
    const { data: session } = await supabase.from("research_sessions").select("id").eq("id", session_id).maybeSingle();
    if (!session) return NextResponse.json({ error: "Research session not found" }, { status: 404 });
  }

  let report;
  try {
    report = await generateResearchReport(supabase, { projectId: project_id, sessionId: session_id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Report generation failed." }, { status: 502 });
  }

  const { data: saved, error: insertError } = await supabase
    .from("research_reports")
    .insert({
      project_id: project_id ?? null,
      session_id: session_id ?? null,
      sections: report.sections,
      overall_assessment: report.overall_assessment,
      confidence_level: report.confidence_level,
      evidence_summary: report.evidence_summary,
      trend_classification: report.trend_classification,
      status: "draft",
    })
    .select()
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json(saved);
});

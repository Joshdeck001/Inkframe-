import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import type { ResearchConcept } from "@/lib/research-agent";

export const dynamic = "force-dynamic";

const BOOK_TYPES = [
  "Fiction", "Nonfiction", "Biography", "Memoir", "Self-help", "Educational",
  "Technical/Professional", "Children's", "Serial Fiction", "Other",
];

/**
 * "Research -> Approved Opportunity -> Create Book Project" (spec
 * section 22) — the one and only research-to-project bridge. Creates a
 * real project (same project_identity/project_scope/project_audience
 * rows the New Book wizard itself writes, left otherwise empty for the
 * author to fill in there) prepopulated from the chosen concept, then
 * links the session AND backfills project_id onto every evidence row the
 * session already collected — so /research, the wizard, and every
 * downstream department (Writing/Metadata/Cover, see their own research
 * lookups) see one consistent project history, not two disconnected
 * ones. Never queues the project for writing itself — status stays
 * 'IDEA', same as any other freshly created project; the author still
 * goes through the wizard to actually start it.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { session_id, concept_index, book_type } = await request.json();
  if (!session_id) return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  if (!BOOK_TYPES.includes(book_type)) return NextResponse.json({ error: `book_type must be one of: ${BOOK_TYPES.join(", ")}` }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: session } = await supabase.from("research_sessions").select("id, topic, user_id").eq("id", session_id).maybeSingle();
  if (!session) return NextResponse.json({ error: "Research session not found" }, { status: 404 });

  const { data: findings } = await supabase.from("research_findings").select("concepts").eq("session_id", session_id).maybeSingle();
  const concepts = (findings?.concepts as ResearchConcept[] | null) ?? [];
  const concept = typeof concept_index === "number" ? concepts[concept_index] : undefined;

  const { data: project, error: projectError } = await supabase.from("projects").insert({ user_id: user.id, book_type, status: "IDEA" }).select("id").single();
  if (projectError || !project) return NextResponse.json({ error: projectError?.message || "Could not create project." }, { status: 500 });

  const workingTitle = concept?.concept || session.topic || "Untitled Project";
  const initialIdea = concept
    ? [concept.concept, ...(concept.rationale ?? [])].join("\n")
    : session.topic
      ? `Based on research into: ${session.topic}`
      : null;

  await Promise.all([
    supabase.from("project_identity").insert({ project_id: project.id, working_title: workingTitle, initial_idea: initialIdea }),
    supabase.from("project_scope").insert({ project_id: project.id }),
    supabase.from("project_audience").insert({ project_id: project.id }),
    supabase.from("research_sessions").update({ project_id: project.id }).eq("id", session_id),
    supabase.from("competitor_research").update({ project_id: project.id }).eq("session_id", session_id).is("project_id", null),
    supabase.from("keyword_research").update({ project_id: project.id }).eq("session_id", session_id).is("project_id", null),
    supabase.from("category_research").update({ project_id: project.id }).eq("session_id", session_id).is("project_id", null),
    supabase.from("research_notes").update({ project_id: project.id }).eq("session_id", session_id).is("project_id", null),
    supabase.from("research_reports").update({ project_id: project.id }).eq("session_id", session_id).is("project_id", null),
  ]);

  return NextResponse.json({ project_id: project.id });
});

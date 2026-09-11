import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import type { ResearchConcept } from "@/lib/research-agent";
import type { BookConcept } from "@/lib/book-intelligence";

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
 * author to fill in there) prepopulated from the chosen concept. Never
 * queues the project for writing itself — status stays 'IDEA', same as
 * any other freshly created project; the author still goes through the
 * wizard to actually start it.
 *
 * Two sources, same downstream shape: `session_id` (+ concept_index into
 * research_findings.concepts — the original Deep Research path) or
 * `opportunity_id` (+ concept_index into scout_opportunities.concepts —
 * the Book Intelligence Workspace path, one InkframeScout capture ->
 * analysis -> concepts -> approved concept -> project). The opportunity
 * path requires the chosen concept's own status to already be
 * "accepted" — a real server-side gate, not just a UI one, since this
 * route is the actual point of no return.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { session_id, opportunity_id, concept_index, book_type } = await request.json();
  if (!session_id && !opportunity_id) return NextResponse.json({ error: "session_id or opportunity_id is required" }, { status: 400 });
  if (!BOOK_TYPES.includes(book_type)) return NextResponse.json({ error: `book_type must be one of: ${BOOK_TYPES.join(", ")}` }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  if (opportunity_id) {
    const { data: opportunity } = await supabase.from("scout_opportunities").select("id, title, concepts").eq("id", opportunity_id).maybeSingle();
    if (!opportunity) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

    const concepts = (opportunity.concepts as (BookConcept & { status: string })[] | null) ?? [];
    const concept = typeof concept_index === "number" ? concepts[concept_index] : undefined;
    if (!concept) return NextResponse.json({ error: "That concept was not found on this opportunity." }, { status: 400 });
    if (concept.status !== "accepted") return NextResponse.json({ error: "Approve this concept first — it must be accepted before a project can be created from it." }, { status: 400 });

    const { data: project, error: projectError } = await supabase.from("projects").insert({ user_id: user.id, book_type, status: "IDEA" }).select("id").single();
    if (projectError || !project) return NextResponse.json({ error: projectError?.message || "Could not create project." }, { status: 500 });

    const workingTitle = concept.title_direction || concept.concept || opportunity.title || "Untitled Project";
    const initialIdea = [concept.concept, `Reader problem: ${concept.reader_problem}`, `Differentiation: ${concept.differentiation}`, `Content angle: ${concept.content_angle}`]
      .filter(Boolean)
      .join("\n");

    await Promise.all([
      supabase.from("project_identity").insert({ project_id: project.id, working_title: workingTitle, subtitle: concept.subtitle_direction || null, initial_idea: initialIdea }),
      supabase.from("project_scope").insert({ project_id: project.id }),
      supabase.from("project_audience").insert({ project_id: project.id, target_audience: concept.target_reader || null, core_promise: concept.differentiation || null }),
      supabase.from("scout_opportunities").update({ status: "converted_to_project", project_id: project.id }).eq("id", opportunity_id),
    ]);

    return NextResponse.json({ project_id: project.id });
  }

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
    // If this session was started from an InkframeScout Opportunity, close the loop: the
    // Opportunity Workspace status machine only ever reaches 'converted_to_project' here,
    // driven by this same real project-creation action — never automatically.
    supabase.from("scout_opportunities").update({ status: "converted_to_project", project_id: project.id }).eq("session_id", session_id),
  ]);

  return NextResponse.json({ project_id: project.id });
});

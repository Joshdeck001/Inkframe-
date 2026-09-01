import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { generateStructured, type ToolSpec } from "@/lib/ai-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby plan's ceiling

const TITLE_RISK_STATUSES = [
  "no_issue",
  "potential_conflict",
  "similar_titles_detected",
  "trademark_concern",
  "metadata_issue",
  "human_review_recommended",
] as const;

const RESEARCH_TOOL: ToolSpec = {
  name: "assess_book",
  description:
    "Assess a book's working title for risk, and research its category for comparable titles and content gaps.",
  input_schema: {
    type: "object" as const,
    properties: {
      title_risk: {
        type: "object",
        properties: {
          status: { type: "string", enum: [...TITLE_RISK_STATUSES] },
          notes: {
            type: "string",
            description:
              "Plain explanation of the finding. Never claim the title is '100% safe' or 'guaranteed clear' — this is a risk flag, not a legal clearance.",
          },
        },
        required: ["status", "notes"],
      },
      category_research: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "What's already crowded in this category/genre, based on general knowledge of the market — not live sales data.",
          },
          differentiation_ideas: {
            type: "array",
            items: { type: "string" },
            description: "Concrete ways this specific book could stand out from what's already common in the category.",
          },
        },
        required: ["summary", "differentiation_ideas"],
      },
    },
    required: ["title_risk", "category_research"],
  },
};

export async function POST(request: Request) {
  const { project_id } = await request.json();
  if (!project_id) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: authError }, { status: authStatus });
  }

  const [{ data: project }, { data: identity }] = await Promise.all([
    supabase.from("projects").select("book_type").eq("id", project_id).single(),
    supabase.from("project_identity").select("working_title, initial_idea").eq("project_id", project_id).single(),
  ]);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const title = identity?.working_title?.trim();

  const facts = [
    `Book type: ${project.book_type}`,
    title ? `Working title: ${title}` : "No working title has been chosen yet.",
    identity?.initial_idea ? `Idea / description: ${identity.initial_idea}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  type ResearchResult = {
    title_risk: { status: (typeof TITLE_RISK_STATUSES)[number]; notes: string };
    category_research: { summary: string; differentiation_ideas: string[] };
  };

  let result: ResearchResult;
  try {
    const generated = await generateStructured<ResearchResult>({
      system:
        "You are InkFrame's Research Department. Flag genuine title risk (confusingly similar existing " +
        "titles, trademark concerns, generic/non-distinctive titles) honestly — this is a risk assessment " +
        "for the author's own judgment, never a legal guarantee, so never say a title is '100% safe' or " +
        "'guaranteed clear'. If no working title was given yet, use status 'no_issue' with a note that there " +
        "is nothing to check yet. Then research what's already common in this book's category from general " +
        "market knowledge (not live data) and suggest concrete differentiation. Call the assess_book tool.",
      userContent: facts,
      tool: RESEARCH_TOOL,
      maxTokens: 1500,
    });
    result = generated.output;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Research did not return structured output." },
      { status: 502 }
    );
  }

  await supabase.from("title_risk_checks").insert({
    project_id,
    title_checked: title || null,
    status: result.title_risk.status,
    notes: result.title_risk.notes,
  });

  await supabase.from("research_notes").insert([
    {
      project_id,
      research_type: "title-risk",
      content: result.title_risk.notes,
    },
    {
      project_id,
      research_type: "genre",
      content:
        result.category_research.summary +
        (result.category_research.differentiation_ideas.length
          ? "\n\nDifferentiation ideas:\n- " + result.category_research.differentiation_ideas.join("\n- ")
          : ""),
    },
  ]);

  return NextResponse.json(result);
}

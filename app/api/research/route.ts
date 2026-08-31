import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TITLE_RISK_STATUSES = [
  "no_issue",
  "potential_conflict",
  "similar_titles_detected",
  "trademark_concern",
  "metadata_issue",
  "human_review_recommended",
] as const;

const RESEARCH_TOOL = {
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const [{ data: project }, { data: identity }] = await Promise.all([
    supabase.from("projects").select("book_type").eq("id", project_id).single(),
    supabase.from("project_identity").select("working_title, initial_idea").eq("project_id", project_id).single(),
  ]);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const title = identity?.working_title?.trim();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured on the server." }, { status: 500 });
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const facts = [
    `Book type: ${project.book_type}`,
    title ? `Working title: ${title}` : "No working title has been chosen yet.",
    identity?.initial_idea ? `Idea / description: ${identity.initial_idea}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 1500,
    system:
      "You are InkFrame's Research Department. Flag genuine title risk (confusingly similar existing " +
      "titles, trademark concerns, generic/non-distinctive titles) honestly — this is a risk assessment " +
      "for the author's own judgment, never a legal guarantee, so never say a title is '100% safe' or " +
      "'guaranteed clear'. If no working title was given yet, use status 'no_issue' with a note that there " +
      "is nothing to check yet. Then research what's already common in this book's category from general " +
      "market knowledge (not live data) and suggest concrete differentiation. Call the assess_book tool.",
    messages: [{ role: "user", content: facts }],
    tools: [RESEARCH_TOOL],
    tool_choice: { type: "tool", name: "assess_book" },
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "Research did not return structured output." }, { status: 502 });
  }

  const result = toolUse.input as {
    title_risk: { status: (typeof TITLE_RISK_STATUSES)[number]; notes: string };
    category_research: { summary: string; differentiation_ideas: string[] };
  };

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

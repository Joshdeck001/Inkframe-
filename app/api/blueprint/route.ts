import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import type { BlueprintStructure } from "@/lib/blueprint-schema";

export const dynamic = "force-dynamic";

const BLUEPRINT_TOOL = {
  name: "generate_blueprint",
  description:
    "Produce the Book Blueprint: Parts containing Chapters, each with an objective, key points, and a word allocation. Word allocation is redistributed by chapter importance — chapters do NOT need equal word counts.",
  input_schema: {
    type: "object" as const,
    properties: {
      parts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            chapters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  number: { type: "integer" },
                  title: { type: "string" },
                  objective: { type: "string", description: "What this chapter must accomplish in the book." },
                  key_points: { type: "array", items: { type: "string" } },
                  word_allocation: { type: "integer" },
                },
                required: ["number", "title", "objective", "key_points", "word_allocation"],
              },
            },
          },
          required: ["title", "chapters"],
        },
      },
    },
    required: ["parts"],
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

  const [{ data: project }, { data: identity }, { data: audience }, { data: scope }, { data: style }, { data: platform }] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", project_id).single(),
      supabase.from("project_identity").select("*").eq("project_id", project_id).single(),
      supabase.from("project_audience").select("*").eq("project_id", project_id).single(),
      supabase.from("project_scope").select("*").eq("project_id", project_id).single(),
      supabase.from("project_style").select("*").eq("project_id", project_id).single(),
      supabase.from("project_platform").select("*").eq("project_id", project_id).single(),
    ]);

  if (!project) {
    // RLS silently returns no row for a project this user doesn't own — treat both the same.
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const promptFacts = [
    `Book type: ${project.book_type}`,
    identity?.working_title ? `Working title: ${identity.working_title}` : null,
    identity?.subtitle ? `Subtitle: ${identity.subtitle}` : null,
    identity?.initial_idea ? `Idea / description: ${identity.initial_idea}` : null,
    identity?.series_name ? `Series: ${identity.series_name}${identity.series_number ? ` #${identity.series_number}` : ""}` : null,
    audience?.target_audience ? `Target audience: ${audience.target_audience}` : null,
    audience?.reader_level ? `Reader level: ${audience.reader_level}` : null,
    audience?.primary_reader_problem ? `Primary reader problem: ${audience.primary_reader_problem}` : null,
    audience?.core_promise ? `Core promise: ${audience.core_promise}` : null,
    audience?.purpose ? `Purpose: ${audience.purpose}` : null,
    scope?.target_word_count ? `Target total word count: ${scope.target_word_count}` : null,
    scope?.estimated_chapter_count ? `Approximate chapter count: ${scope.estimated_chapter_count}` : null,
    scope?.desired_depth ? `Desired depth: ${scope.desired_depth}` : null,
    style?.tone ? `Tone: ${style.tone}` : null,
    style?.pov ? `POV: ${style.pov}` : null,
    style?.pacing ? `Pacing: ${style.pacing}` : null,
    style?.depth ? `Style depth: ${style.depth}` : null,
    style?.additional_instructions ? `Additional instructions: ${style.additional_instructions}` : null,
    platform?.platform_target ? `Target platform: ${platform.platform_target}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    system:
      "You are InkFrame's Blueprint Department. Given a project's known facts, produce a Book Blueprint: " +
      "Parts, each containing Chapters with an objective, key points, and a word allocation. Redistribute " +
      "word allocation by chapter importance — do not force every chapter to the same length. Chapter " +
      "numbers must be sequential starting at 1 across the whole book. The sum of all chapters' " +
      "word_allocation should land close to the target total word count when one is given. Call the " +
      "generate_blueprint tool with the result — do not respond with prose.",
    messages: [{ role: "user", content: promptFacts || "No details were provided beyond the book type." }],
    tools: [BLUEPRINT_TOOL],
    tool_choice: { type: "tool", name: "generate_blueprint" },
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "Blueprint generation did not return structured output." }, { status: 502 });
  }

  const structure = toolUse.input as BlueprintStructure;

  const { data: existing } = await supabase
    .from("book_blueprint")
    .select("version")
    .eq("project_id", project_id)
    .order("version", { ascending: false })
    .limit(1);

  const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  const { data: blueprint, error: insertError } = await supabase
    .from("book_blueprint")
    .insert({ project_id, version: nextVersion, structure, approval_status: "draft" })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await supabase.from("projects").update({ status: "AWAITING_APPROVAL" }).eq("id", project_id);

  return NextResponse.json({ blueprint });
}

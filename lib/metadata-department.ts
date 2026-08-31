import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

const METADATA_TOOL = {
  name: "generate_metadata",
  description: "Generate Amazon KDP-style listing metadata for a finished book.",
  input_schema: {
    type: "object" as const,
    properties: {
      description_long: { type: "string", description: "Full back-cover-style description, leading with the core promise/outcome, using natural language (not keyword-stuffed)." },
      description_short: { type: "string", description: "A one-to-two sentence version for places with tight character limits." },
      keywords: {
        type: "array",
        items: { type: "string" },
        minItems: 7,
        maxItems: 7,
        description: "Exactly 7 keyword phrases, each 50 characters or fewer, none repeating words already in the title/subtitle/categories.",
      },
      categories: { type: "array", items: { type: "string" }, description: "e.g. 'Literature & Fiction > Contemporary Fiction'." },
      bisac_codes: { type: "array", items: { type: "string" } },
    },
    required: ["description_long", "description_short", "keywords", "categories", "bisac_codes"],
  },
};

export async function runMetadataDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const { data: project, error: projectQueryError } = await supabase
    .from("projects")
    .select("id, book_type")
    .eq("status", "GENERATING_METADATA")
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);
  if (!project) return { processed: false, detail: "No projects awaiting metadata generation." };

  const [{ data: identity }, { data: audience }, { data: chapters }] = await Promise.all([
    supabase.from("project_identity").select("*").eq("project_id", project.id).single(),
    supabase.from("project_audience").select("*").eq("project_id", project.id).single(),
    supabase
      .from("chapters")
      .select("chapter_number, title, objective")
      .eq("project_id", project.id)
      .order("chapter_number", { ascending: true }),
  ]);

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const facts = [
    `Book type: ${project.book_type}`,
    identity?.working_title ? `Title: ${identity.working_title}` : null,
    identity?.subtitle ? `Subtitle: ${identity.subtitle}` : null,
    identity?.initial_idea ? `Idea: ${identity.initial_idea}` : null,
    audience?.core_promise ? `Core promise: ${audience.core_promise}` : null,
    audience?.target_audience ? `Target audience: ${audience.target_audience}` : null,
    chapters && chapters.length > 0
      ? `Chapters:\n${chapters.map((c) => `${c.chapter_number}. ${c.title} — ${c.objective}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 2000,
    system:
      "You are InkFrame's Metadata Department, writing Amazon KDP listing copy. Exactly 7 keyword " +
      "phrases, each <=50 characters, that genuinely describe the book — never repeat words already used " +
      "in the title/subtitle/category, and write natural multi-word phrases rather than keyword-stuffed " +
      "fragments (KDP's ranking system penalizes unreadable titles/keywords). Description leads with the " +
      "core promise/outcome. Call the generate_metadata tool.",
    messages: [{ role: "user", content: facts }],
    tools: [METADATA_TOOL],
    tool_choice: { type: "tool", name: "generate_metadata" },
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Metadata generation did not return structured output.");

  const result = toolUse.input as {
    description_long: string;
    description_short: string;
    keywords: string[];
    categories: string[];
    bisac_codes: string[];
  };

  const { error: upsertError } = await supabase
    .from("metadata_department")
    .upsert(
      {
        project_id: project.id,
        description_long: result.description_long,
        description_short: result.description_short,
        keywords: result.keywords.slice(0, 7),
        categories: result.categories,
        bisac_codes: result.bisac_codes,
      },
      { onConflict: "project_id" }
    );
  if (upsertError) throw new Error(upsertError.message);

  await supabase.from("projects").update({ status: "COMPLIANCE_CHECK" }).eq("id", project.id);

  return { processed: true, detail: `Project ${project.id}: metadata generated, moved to COMPLIANCE_CHECK.` };
}

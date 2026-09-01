import type { SupabaseClient } from "@supabase/supabase-js";
import { getPausedProjectIds } from "@/lib/production-paused";
import { generateStructured, type ToolSpec } from "@/lib/ai-client";

const METADATA_TOOL: ToolSpec = {
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
  const pausedProjectIds = await getPausedProjectIds(supabase);

  let projectQuery = supabase.from("projects").select("id, book_type").eq("status", "GENERATING_METADATA");
  if (pausedProjectIds.length > 0) {
    projectQuery = projectQuery.not("id", "in", `(${pausedProjectIds.join(",")})`);
  }
  const { data: project, error: projectQueryError } = await projectQuery
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

  const { output: result } = await generateStructured<{
    description_long: string;
    description_short: string;
    keywords: string[];
    categories: string[];
    bisac_codes: string[];
  }>({
    system:
      "You are InkFrame's Metadata Department, writing Amazon KDP listing copy. Exactly 7 keyword " +
      "phrases, each <=50 characters, that genuinely describe the book — never repeat words already used " +
      "in the title/subtitle/category, and write natural multi-word phrases rather than keyword-stuffed " +
      "fragments (KDP's ranking system penalizes unreadable titles/keywords). Description leads with the " +
      "core promise/outcome. Call the generate_metadata tool.",
    userContent: facts,
    tool: METADATA_TOOL,
    maxTokens: 2000,
  });

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

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPausedProjectIds } from "@/lib/production-paused";

const QUALITY_DIMENSIONS = [
  "structure",
  "continuity",
  "readability",
  "instruction_adherence",
  "repetition",
  "pacing",
  "factual_consistency",
  "character_consistency",
  "platform_suitability",
  "completeness",
] as const;

const REVISION_THRESHOLD = 70; // average score, 0-100 — internal assessment, not a guarantee
const MAX_AUTO_REVISIONS = 1; // bounded loop: revise once, then move on regardless of outcome

const SCORE_TOOL = {
  name: "score_chapter",
  description: `Score a chapter on each of: ${QUALITY_DIMENSIONS.join(", ")} (0-100 each), and say whether it needs revision.`,
  input_schema: {
    type: "object" as const,
    properties: {
      scores: {
        type: "object",
        properties: Object.fromEntries(
          QUALITY_DIMENSIONS.map((d) => [
            d,
            { type: "integer", minimum: 0, maximum: 100 },
          ])
        ),
        required: [...QUALITY_DIMENSIONS],
      },
      needs_revision: { type: "boolean" },
      issues: { type: "array", items: { type: "string" }, description: "Specific, actionable problems found." },
    },
    required: ["scores", "needs_revision", "issues"],
  },
};

type QualityScore = Record<(typeof QUALITY_DIMENSIONS)[number], number> & {
  needs_revision: boolean;
  issues: string[];
};

function average(scores: QualityScore): number {
  const values = QUALITY_DIMENSIONS.map((d) => scores[d]);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * One tick of the Quality Loop: picks the single least-recently-touched
 * REVIEWING project, scores its next 'written' chapter, revises once if the
 * score is low, then marks it approved either way (bounded loop — never
 * spins forever chasing a perfect score). Once every chapter in a project
 * is approved, moves the project to READY_FOR_REVIEW — the system's
 * internal pass is done; the user's own review comes next.
 */
export async function runQualityLoopTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const pausedProjectIds = await getPausedProjectIds(supabase);

  let projectQuery = supabase.from("projects").select("id, book_type").eq("status", "REVIEWING");
  if (pausedProjectIds.length > 0) {
    projectQuery = projectQuery.not("id", "in", `(${pausedProjectIds.join(",")})`);
  }
  const { data: project, error: projectQueryError } = await projectQuery
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);
  if (!project) return { processed: false, detail: "No projects awaiting review." };

  const { data: chapter, error: chapterQueryError } = await supabase
    .from("chapters")
    .select("*")
    .eq("project_id", project.id)
    .eq("status", "written")
    .order("chapter_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (chapterQueryError) throw new Error(`Could not query chapters: ${chapterQueryError.message}`);

  if (!chapter) {
    // No 'written' chapters left waiting on a first pass — either every
    // chapter is approved, or some are still 'revising' from a prior tick.
    const { count: unapprovedCount } = await supabase
      .from("chapters")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .neq("status", "approved");

    if (unapprovedCount === 0) {
      // Hands off to the Cover → Metadata → Compliance → Formatting chain
      // (Step 9) before landing on READY_FOR_REVIEW — matches both the
      // schema's documented status order and job-progress's pipeline icon
      // order, so nothing downstream has to fake a "done" out of sequence.
      await supabase.from("projects").update({ status: "GENERATING_COVER" }).eq("id", project.id);
      return { processed: true, detail: `Project ${project.id}: every chapter approved, moved to GENERATING_COVER.` };
    }
    return { processed: false, detail: `Project ${project.id}: chapters still mid-revision.` };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const score = await scoreChapter(anthropic, chapter);
  const avg = average(score);
  const passed = avg >= REVISION_THRESHOLD && !score.needs_revision;
  const canRevise = chapter.revision_count < MAX_AUTO_REVISIONS;

  if (!passed && canRevise) {
    await supabase.from("chapters").update({ status: "revising", quality_score: score }).eq("id", chapter.id);

    const revised = await reviseChapter(anthropic, chapter, score.issues);
    const wordCount = revised.split(/\s+/).filter(Boolean).length;

    await supabase
      .from("chapters")
      .update({
        content: revised,
        actual_words: wordCount,
        status: "approved",
        revision_count: chapter.revision_count + 1,
      })
      .eq("id", chapter.id);

    return {
      processed: true,
      detail: `Project ${project.id}: revised and approved chapter ${chapter.chapter_number} (avg score was ${avg.toFixed(0)}).`,
    };
  }

  await supabase.from("chapters").update({ status: "approved", quality_score: score }).eq("id", chapter.id);
  return {
    processed: true,
    detail: `Project ${project.id}: approved chapter ${chapter.chapter_number} (avg score ${avg.toFixed(0)}).`,
  };
}

async function scoreChapter(
  anthropic: Anthropic,
  chapter: { chapter_number: number; title: string; objective: string; content: string }
): Promise<QualityScore> {
  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 2000,
    system:
      "You are InkFrame's Quality Loop. Score this chapter honestly on each dimension (0-100) against its " +
      "stated objective. These scores are an internal assessment only, never presented to the reader as a " +
      "scientific guarantee — be direct about real weaknesses. Call the score_chapter tool with the result.",
    messages: [
      {
        role: "user",
        content: `Chapter ${chapter.chapter_number}: ${chapter.title}\nObjective: ${chapter.objective}\n\n${chapter.content}`,
      },
    ],
    tools: [SCORE_TOOL],
    tool_choice: { type: "tool", name: "score_chapter" },
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Quality scoring did not return structured output.");
  }
  const input = toolUse.input as { scores: Record<string, number>; needs_revision: boolean; issues: string[] };
  return { ...(input.scores as QualityScore), needs_revision: input.needs_revision, issues: input.issues };
}

async function reviseChapter(
  anthropic: Anthropic,
  chapter: { chapter_number: number; title: string; objective: string; target_words: number; content: string },
  issues: string[]
): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    system:
      "You are InkFrame's Writing Agent revising one chapter to fix specific issues found by the Quality " +
      "Loop, while preserving what already works. Output ONLY the revised chapter's full prose — no heading, " +
      "no meta-commentary, no diff notation.",
    messages: [
      {
        role: "user",
        content:
          `Chapter ${chapter.chapter_number}: ${chapter.title}\nObjective: ${chapter.objective}\n` +
          `Target length: about ${chapter.target_words} words\n\nIssues to fix:\n- ${issues.join("\n- ")}\n\n` +
          `Current chapter:\n${chapter.content}`,
      },
    ],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : chapter.content;
}

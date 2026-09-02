import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlueprintStructure } from "@/lib/blueprint-schema";
import { getPausedProjectIds } from "@/lib/production-paused";
import { generateText, modelUsedLabel } from "@/lib/ai-client";
import { isStructuredBookType, getDesignFamily, writingGuidanceFor } from "@/lib/book-format";

/**
 * One tick of the autonomous Writing Agent: picks the single
 * least-recently-touched QUEUED/WRITING project, ensures its `chapters`
 * rows exist (seeded from the approved blueprint on first run), drafts the
 * next pending chapter, and updates project/chapter status.
 *
 * Deliberately does ONE chapter per call — cron frequency paces overall
 * throughput instead of one long-running invocation. MVP continuity: passes
 * the tail of the previous chapter as context rather than the full DK 2.0
 * story_bible extraction pipeline (that lands once the fuller writing-prompt
 * specs are available).
 */
export async function runWritingAgentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const pausedProjectIds = await getPausedProjectIds(supabase);

  let projectQuery = supabase
    .from("projects")
    .select("id, status, book_type")
    .in("status", ["QUEUED", "WRITING"]);
  if (pausedProjectIds.length > 0) {
    projectQuery = projectQuery.not("id", "in", `(${pausedProjectIds.join(",")})`);
  }
  const { data: project, error: projectQueryError } = await projectQuery
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) {
    throw new Error(`Could not query projects: ${projectQueryError.message}`);
  }

  if (!project) {
    return { processed: false, detail: "No queued or writing projects." };
  }

  await ensureChaptersSeeded(supabase, project.id);

  const { data: nextChapter } = await supabase
    .from("chapters")
    .select("*")
    .eq("project_id", project.id)
    .in("status", ["pending", "writing"])
    .order("chapter_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextChapter) {
    // All chapters written — hand off to the (not-yet-built) Quality Loop.
    await supabase.from("projects").update({ status: "REVIEWING" }).eq("id", project.id);
    return { processed: true, detail: `Project ${project.id}: all chapters drafted, moved to REVIEWING.` };
  }

  await supabase
    .from("chapters")
    .update({ status: "writing" })
    .eq("id", nextChapter.id);
  await supabase.from("projects").update({ status: "WRITING" }).eq("id", project.id);

  const [{ data: identity }, { data: audience }, { data: style }] = await Promise.all([
    supabase.from("project_identity").select("*").eq("project_id", project.id).single(),
    supabase.from("project_audience").select("*").eq("project_id", project.id).single(),
    supabase.from("project_style").select("*").eq("project_id", project.id).single(),
  ]);

  let previousChapterTail = "";
  if (nextChapter.chapter_number > 1) {
    const { data: prevChapter } = await supabase
      .from("chapters")
      .select("content")
      .eq("project_id", project.id)
      .eq("chapter_number", nextChapter.chapter_number - 1)
      .maybeSingle();
    if (prevChapter?.content) {
      previousChapterTail = prevChapter.content.slice(-3000);
    }
  }

  const facts = [
    `Book type: ${project.book_type}`,
    identity?.working_title ? `Title: ${identity.working_title}` : null,
    identity?.initial_idea ? `Book idea: ${identity.initial_idea}` : null,
    audience?.target_audience ? `Target audience: ${audience.target_audience}` : null,
    audience?.core_promise ? `Core promise: ${audience.core_promise}` : null,
    style?.tone ? `Tone: ${style.tone}` : null,
    style?.pov ? `POV: ${style.pov}` : null,
    style?.pacing ? `Pacing: ${style.pacing}` : null,
    style?.additional_instructions ? `Additional instructions: ${style.additional_instructions}` : null,
    "",
    `Chapter ${nextChapter.chapter_number}: ${nextChapter.title}`,
    `Objective: ${nextChapter.objective}`,
    `Target length: about ${nextChapter.target_words} words`,
    previousChapterTail ? `\nEnd of the previous chapter, for continuity:\n${previousChapterTail}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const structured = isStructuredBookType(project.book_type);
  const family = getDesignFamily(project.book_type);
  const familyGuidance = writingGuidanceFor(family);

  const generated = await generateText({
    system: structured
      ? "You are InkFrame's Writing Agent, writing ONE chapter of a structured non-fiction guide/workbook " +
        "given its objective and target length, in the specified tone/pacing, continuing naturally from the " +
        "previous chapter's ending when one is given. Use lightweight Markdown structure where it genuinely " +
        "helps the reader — '## ' for a subheading, '- ' for a bullet list, '1. ' for a numbered list/steps, " +
        "and triple-backtick fenced code blocks for any code, commands, or exact syntax. Don't overuse " +
        "structure: most of the chapter should still be plain prose paragraphs, with headings/lists/code " +
        "blocks used only where they add real clarity (a step-by-step process, a checklist, a code sample). " +
        (familyGuidance ? `${familyGuidance} ` : "") +
        "Output ONLY the chapter's content — no chapter-number heading, no title restatement, no " +
        "meta-commentary."
      : "You are InkFrame's Writing Agent. Write the full prose of ONE chapter given its objective and " +
        "target length, in the specified tone/POV/pacing, continuing naturally from the previous chapter's " +
        "ending when one is given. Output ONLY the chapter's prose — no chapter-number heading, no title " +
        "restatement, no meta-commentary.",
    userContent: facts,
    maxTokens: 8000,
  });

  const chapterText = generated.text;
  const wordCount = chapterText ? chapterText.split(/\s+/).filter(Boolean).length : 0;

  await supabase
    .from("chapters")
    .update({
      content: chapterText,
      actual_words: wordCount,
      status: "written",
      model_used: modelUsedLabel(generated),
    })
    .eq("id", nextChapter.id);

  const { data: scope } = await supabase
    .from("project_scope")
    .select("words_written")
    .eq("project_id", project.id)
    .single();
  await supabase
    .from("project_scope")
    .update({ words_written: (scope?.words_written ?? 0) + wordCount })
    .eq("project_id", project.id);

  return {
    processed: true,
    detail: `Project ${project.id}: wrote chapter ${nextChapter.chapter_number} (${wordCount} words).`,
  };
}

async function ensureChaptersSeeded(supabase: SupabaseClient, projectId: string) {
  const { count } = await supabase
    .from("chapters")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (count && count > 0) return;

  const { data: blueprint } = await supabase
    .from("book_blueprint")
    .select("structure")
    .eq("project_id", projectId)
    .eq("approval_status", "approved")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!blueprint) return;

  const structure = blueprint.structure as BlueprintStructure;
  const rows = structure.parts.flatMap((part) =>
    part.chapters.map((chapter) => ({
      project_id: projectId,
      chapter_number: chapter.number,
      title: chapter.title,
      objective: chapter.objective,
      target_words: chapter.word_allocation,
      status: "pending" as const,
    }))
  );
  if (rows.length > 0) {
    await supabase.from("chapters").insert(rows);
  }
}

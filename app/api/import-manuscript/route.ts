import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { splitIntoChapters, wordCount } from "@/lib/manuscript-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;
const BOOK_TYPES = [
  "Fiction",
  "Nonfiction",
  "Biography",
  "Memoir",
  "Self-help",
  "Educational",
  "Technical/Professional",
  "Children's",
  "Serial Fiction",
  "Other",
] as const;
const TRIM_SIZES = ["5x8", "5.5x8.5", "6x9", "8.5x11"] as const;

/**
 * "I already wrote this — just format it": creates a project from an
 * uploaded .docx and seeds its chapters directly from the real content,
 * skipping the Writing Agent and Quality Loop entirely (chapters go
 * straight to 'approved' — never handed to the AI to score or, worse,
 * silently rewrite). Cover/Metadata/Compliance/Formatting still run
 * normally afterward, same as any AI-written book, since those are
 * genuinely useful regardless of who wrote the words. Only .docx is
 * supported — that's the one format lib/manuscript-import.ts's Word
 * "Heading 1"-based chapter splitting was actually built and verified
 * against; a PDF/plain-text path would need its own real verification,
 * not a guess this route doesn't make.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const formData = await request.formData();
  const file = formData.get("file");
  const workingTitle = formData.get("title");
  const subtitle = formData.get("subtitle");
  const authorName = formData.get("author_name");
  const bookType = formData.get("book_type");
  const trimSize = formData.get("trim_size");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A .docx file is required." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 20MB or smaller." }, { status: 400 });
  }
  if (typeof workingTitle !== "string" || !workingTitle.trim()) {
    return NextResponse.json({ error: "A working title is required." }, { status: 400 });
  }
  if (typeof bookType !== "string" || !BOOK_TYPES.includes(bookType as (typeof BOOK_TYPES)[number])) {
    return NextResponse.json({ error: "A valid book type is required." }, { status: 400 });
  }
  const resolvedTrimSize =
    typeof trimSize === "string" && TRIM_SIZES.includes(trimSize as (typeof TRIM_SIZES)[number]) ? trimSize : "6x9";

  let html: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.convertToHtml({ buffer });
    html = result.value;
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read that file — is it a real .docx? (${e instanceof Error ? e.message : String(e)})` },
      { status: 400 }
    );
  }

  const chapters = splitIntoChapters(html, workingTitle.trim());
  if (chapters.length === 0) {
    return NextResponse.json({ error: "No readable text was found in that file." }, { status: 400 });
  }

  const totalWords = chapters.reduce((sum, c) => sum + wordCount(c.content), 0);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({ user_id: user.id, book_type: bookType, status: "GENERATING_COVER" })
    .select()
    .single();
  if (projectError || !project) {
    return NextResponse.json({ error: projectError?.message || "Could not create project." }, { status: 500 });
  }
  const projectId = project.id as string;

  const [identityRes, scopeRes] = await Promise.all([
    supabase.from("project_identity").insert({
      project_id: projectId,
      working_title: workingTitle.trim(),
      subtitle: typeof subtitle === "string" && subtitle.trim() ? subtitle.trim() : null,
      author_name: typeof authorName === "string" && authorName.trim() ? authorName.trim() : null,
      language: "English",
    }),
    supabase.from("project_scope").insert({
      project_id: projectId,
      target_word_count: totalWords,
      estimated_chapter_count: chapters.length,
      words_written: totalWords,
    }),
  ]);
  const firstError = [identityRes, scopeRes].find((r) => r.error)?.error;
  if (firstError) {
    // Roll back rather than leave an orphaned, half-set-up project behind.
    await supabase.from("projects").delete().eq("id", projectId);
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  // Best-effort, same reason as the wizard's own trim_size writes: a stale
  // PostgREST schema cache on some Supabase projects can reject this newer
  // column even though it exists, and that must never block the import —
  // the formatting engine already falls back to 6x9 when it's unset.
  await supabase.from("project_scope").update({ trim_size: resolvedTrimSize }).eq("project_id", projectId);

  const { error: chaptersError } = await supabase.from("chapters").insert(
    chapters.map((c, i) => ({
      project_id: projectId,
      chapter_number: i + 1,
      title: c.title,
      objective: "Imported from the author's own manuscript.",
      target_words: wordCount(c.content),
      actual_words: wordCount(c.content),
      content: c.content,
      status: "approved",
      model_used: "user_import",
    }))
  );
  if (chaptersError) {
    await supabase.from("projects").delete().eq("id", projectId);
    return NextResponse.json({ error: chaptersError.message }, { status: 500 });
  }

  return NextResponse.json({ project_id: projectId, chapters: chapters.length, words: totalWords });
});

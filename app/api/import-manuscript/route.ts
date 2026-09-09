import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { wordCount } from "@/lib/manuscript-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
const MAX_CHAPTERS = 500;

/**
 * Step 2 of the import flow: takes the chapter list the author already
 * reviewed/reordered/renamed on the client (parsed by
 * /api/import-manuscript/parse, never re-derived here) and creates the
 * project from it — skipping the Writing Agent and Quality Loop entirely,
 * chapters go straight to 'approved' so nothing ever silently rewrites the
 * author's own words. Cover/Metadata/Compliance/Formatting still run
 * normally afterward, same as any AI-written book.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { chapters, title, subtitle, author_name, book_type, trim_size } = body as Record<string, unknown>;

  if (
    !Array.isArray(chapters) ||
    chapters.length === 0 ||
    chapters.length > MAX_CHAPTERS ||
    !chapters.every(
      (c) =>
        c &&
        typeof c === "object" &&
        typeof (c as Record<string, unknown>).title === "string" &&
        typeof (c as Record<string, unknown>).content === "string" &&
        (c as Record<string, unknown>).content
    )
  ) {
    return NextResponse.json({ error: "At least one chapter with real content is required." }, { status: 400 });
  }
  const reviewedChapters = chapters as { title: string; content: string }[];

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "A working title is required." }, { status: 400 });
  }
  if (typeof book_type !== "string" || !BOOK_TYPES.includes(book_type as (typeof BOOK_TYPES)[number])) {
    return NextResponse.json({ error: "A valid book type is required." }, { status: 400 });
  }
  const resolvedTrimSize =
    typeof trim_size === "string" && TRIM_SIZES.includes(trim_size as (typeof TRIM_SIZES)[number]) ? trim_size : "6x9";

  const totalWords = reviewedChapters.reduce((sum, c) => sum + wordCount(c.content), 0);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({ user_id: user.id, book_type, status: "GENERATING_COVER" })
    .select()
    .single();
  if (projectError || !project) {
    return NextResponse.json({ error: projectError?.message || "Could not create project." }, { status: 500 });
  }
  const projectId = project.id as string;

  const [identityRes, scopeRes] = await Promise.all([
    supabase.from("project_identity").insert({
      project_id: projectId,
      working_title: title.trim(),
      subtitle: typeof subtitle === "string" && subtitle.trim() ? subtitle.trim() : null,
      author_name: typeof author_name === "string" && author_name.trim() ? author_name.trim() : null,
      language: "English",
    }),
    supabase.from("project_scope").insert({
      project_id: projectId,
      target_word_count: totalWords,
      estimated_chapter_count: reviewedChapters.length,
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
    reviewedChapters.map((c, i) => ({
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

  return NextResponse.json({ project_id: projectId, chapters: reviewedChapters.length, words: totalWords });
});

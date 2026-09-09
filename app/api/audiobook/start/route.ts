import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { OPENAI_TTS_VOICES } from "@/lib/audio-client";

export const dynamic = "force-dynamic";

/**
 * The explicit human-approval gate for Audiobook Studio (spec: critical
 * operations require explicit user approval) — narration never starts on
 * its own. Creates one audiobook_jobs row plus one audiobook_segments row
 * per approved chapter; the cron tick (lib/audiobook-department.ts) then
 * narrates them one at a time. Only approved chapters are narrated —
 * never a draft still being revised by the Quality Loop.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { project_id, voice } = await request.json();
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (!OPENAI_TTS_VOICES.includes(voice)) {
    return NextResponse.json({ error: `voice must be one of: ${OPENAI_TTS_VOICES.join(", ")}` }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: project } = await supabase.from("projects").select("id").eq("id", project_id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: chapters, error: chaptersError } = await supabase
    .from("chapters")
    .select("id, chapter_number")
    .eq("project_id", project_id)
    .eq("status", "approved")
    .order("chapter_number", { ascending: true });
  if (chaptersError) return NextResponse.json({ error: chaptersError.message }, { status: 500 });
  if (!chapters || chapters.length === 0) {
    return NextResponse.json({ error: "No approved chapters to narrate yet." }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from("audiobook_jobs")
    .insert({ project_id, voice, status: "pending" })
    .select("id")
    .single();
  if (jobError || !job) return NextResponse.json({ error: jobError?.message || "Could not create audiobook job." }, { status: 500 });

  const { error: segmentsError } = await supabase.from("audiobook_segments").insert(
    chapters.map((c) => ({ job_id: job.id, chapter_id: c.id, chapter_number: c.chapter_number, status: "pending" }))
  );
  if (segmentsError) {
    await supabase.from("audiobook_jobs").delete().eq("id", job.id);
    return NextResponse.json({ error: segmentsError.message }, { status: 500 });
  }

  await supabase
    .from("publishing_log")
    .insert({ project_id, event: `Audiobook production started (voice: ${voice}, ${chapters.length} chapter(s)).` });

  return NextResponse.json({ job_id: job.id, chapters: chapters.length });
});

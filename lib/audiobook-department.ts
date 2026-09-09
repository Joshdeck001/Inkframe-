import type { SupabaseClient } from "@supabase/supabase-js";
import { generateChapterAudio, type TtsVoice } from "@/lib/audio-client";

/**
 * One tick advances exactly one chapter of one audiobook job — same
 * "one unit of work per tick" shape as every other department. Only ever
 * acts on jobs a user explicitly started via /api/audiobook/start; unlike
 * the core writing pipeline, nothing here is triggered by a project's own
 * status. Never claims success on a failed narration: a chapter that
 * fails is marked 'failed' with the real error, never silently skipped or
 * reported as done.
 */
export async function runAudiobookDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const { data: job, error: jobQueryError } = await supabase
    .from("audiobook_jobs")
    .select("id, project_id, voice, status")
    .in("status", ["pending", "generating"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (jobQueryError) throw new Error(`Could not query audiobook_jobs: ${jobQueryError.message}`);
  if (!job) return { processed: false, detail: "No audiobook jobs waiting." };

  if (job.status === "pending") {
    await supabase.from("audiobook_jobs").update({ status: "generating" }).eq("id", job.id);
  }

  const { data: segment, error: segmentQueryError } = await supabase
    .from("audiobook_segments")
    .select("id, chapter_id, chapter_number")
    .eq("job_id", job.id)
    .eq("status", "pending")
    .order("chapter_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (segmentQueryError) throw new Error(`Could not query audiobook_segments: ${segmentQueryError.message}`);

  if (!segment) {
    // No pending segments left — if every segment reached a terminal state, the job is ready for review.
    const { data: remaining } = await supabase
      .from("audiobook_segments")
      .select("id, status")
      .eq("job_id", job.id)
      .in("status", ["pending", "generating"]);

    if (remaining && remaining.length > 0) {
      return { processed: false, detail: `Job ${job.id}: segments still in progress from another tick.` };
    }

    const { count: failedCount } = await supabase
      .from("audiobook_segments")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id)
      .eq("status", "failed");

    await supabase.from("audiobook_jobs").update({ status: "ready_for_review" }).eq("id", job.id);
    await supabase.from("publishing_log").insert({
      project_id: job.project_id,
      event: `Audiobook production ready for review${failedCount ? ` — ${failedCount} chapter(s) failed narration` : ""}.`,
    });
    return { processed: true, detail: `Job ${job.id}: all chapters attempted, moved to ready_for_review.` };
  }

  await supabase.from("audiobook_segments").update({ status: "generating" }).eq("id", segment.id);

  const { data: chapter } = await supabase
    .from("chapters")
    .select("content, actual_words")
    .eq("id", segment.chapter_id)
    .single();

  if (!chapter?.content?.trim()) {
    await supabase
      .from("audiobook_segments")
      .update({ status: "failed", error: "Chapter has no content to narrate." })
      .eq("id", segment.id);
    return { processed: true, detail: `Job ${job.id}: chapter ${segment.chapter_number} has no content, marked failed.` };
  }

  const { data: project } = await supabase.from("projects").select("user_id").eq("id", job.project_id).single();
  if (!project) {
    await supabase.from("audiobook_segments").update({ status: "failed", error: "Could not resolve project owner." }).eq("id", segment.id);
    return { processed: true, detail: `Job ${job.id}: chapter ${segment.chapter_number} failed — no owner.` };
  }

  try {
    const audio = await generateChapterAudio(chapter.content, job.voice as TtsVoice);
    const path = `${project.user_id}/${job.id}/chapter-${segment.chapter_number}.mp3`;

    const { error: uploadError } = await supabase.storage.from("audiobooks").upload(path, audio.buffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    const wordCount = chapter.actual_words || chapter.content.split(/\s+/).filter(Boolean).length;
    await supabase
      .from("audiobook_segments")
      .update({
        status: "generated",
        audio_file_ref: path,
        duration_estimate_seconds: Math.round((wordCount / 150) * 60), // estimate only — never measured from the real audio
        error: null,
      })
      .eq("id", segment.id);

    return {
      processed: true,
      detail: `Job ${job.id}: narrated chapter ${segment.chapter_number} (${audio.chunkCount} chunk(s), ${audio.model}).`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from("audiobook_segments").update({ status: "failed", error: message }).eq("id", segment.id);
    return { processed: true, detail: `Job ${job.id}: chapter ${segment.chapter_number} narration failed — ${message}` };
  }
}

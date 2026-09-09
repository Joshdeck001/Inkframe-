"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { OPENAI_TTS_VOICES } from "@/lib/audio-client";

export const dynamic = "force-dynamic";

type Job = { id: string; voice: string; status: string };
type Segment = {
  id: string;
  chapter_number: number;
  status: "pending" | "generating" | "generated" | "failed";
  duration_estimate_seconds: number | null;
  error: string | null;
};

const STATUS_LABEL: Record<Segment["status"], string> = {
  pending: "Waiting",
  generating: "Narrating…",
  generated: "✓ Ready",
  failed: "⚠ Failed",
};

function AudiobookBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const supabase = createClient();

  const [voice, setVoice] = useState<string>(OPENAI_TTS_VOICES[0]);
  const [job, setJob] = useState<Job | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  async function loadJob() {
    if (!projectId) return;
    const { data: latestJob } = await supabase
      .from("audiobook_jobs")
      .select("id, voice, status")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setJob(latestJob ?? null);
    if (latestJob) {
      const { data: segs } = await supabase
        .from("audiobook_segments")
        .select("id, chapter_number, status, duration_estimate_seconds, error")
        .eq("job_id", latestJob.id)
        .order("chapter_number", { ascending: true });
      setSegments(segs ?? []);
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadJob, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!job || job.status === "complete") return;
    const interval = setInterval(loadJob, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  async function handleStart() {
    if (!projectId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/audiobook/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, voice }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not start audiobook production.");
      await loadJob();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start audiobook production.");
    } finally {
      setStarting(false);
    }
  }

  async function handlePlay(segmentId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/audiobook-download?segment=${segmentId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load that chapter's audio.");
      setPlayingUrl(json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that chapter's audio.");
    }
  }

  async function handleMarkComplete() {
    if (!job) return;
    setCompleting(true);
    const { error } = await supabase.from("audiobook_jobs").update({ status: "complete" }).eq("id", job.id);
    setCompleting(false);
    if (error) setError(error.message);
    else setJob({ ...job, status: "complete" });
  }

  if (!projectId) {
    return (
      <div className="empty-panel">
        <div className="ei">🎧</div>
        <h3>No project selected</h3>
        <p>Open a book from My Books to produce its audiobook.</p>
        <button className="btn btn-primary" onClick={() => router.push("/books")}>
          Go to My Books
        </button>
      </div>
    );
  }

  const generatedCount = segments.filter((s) => s.status === "generated").length;
  const failedCount = segments.filter((s) => s.status === "failed").length;

  return (
    <>
      {!job || job.status === "complete" ? (
        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "14px" }}>{job ? "Produce Another Narration Pass" : "Start Audiobook Production"}</div>
          <div className="field">
            <label>Voice</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {OPENAI_TTS_VOICES.map((v) => (
                <option key={v} value={v} style={{ textTransform: "capitalize" }}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <p className="hint" style={{ marginBottom: "14px" }}>
            Narrates every approved chapter using OpenAI text-to-speech. Real generated audio — you review every
            chapter below before this counts as complete.
          </p>
          <button className="btn btn-primary" onClick={handleStart} disabled={starting}>
            {starting ? "Starting…" : "Start Audiobook Production"}
          </button>
        </div>
      ) : (
        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "10px" }}>
            Voice: <span style={{ textTransform: "capitalize" }}>{job.voice}</span>
          </div>
          <div className="check-row">
            <span>Status</span>
            <span className={job.status === "ready_for_review" ? "ok" : undefined}>{job.status.replace(/_/g, " ")}</span>
          </div>
          <div className="check-row">
            <span>Chapters narrated</span>
            <span>
              {generatedCount} of {segments.length}
              {failedCount > 0 ? ` (${failedCount} failed)` : ""}
            </span>
          </div>
        </div>
      )}

      {playingUrl && (
        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "10px" }}>Now Playing</div>
          <audio controls autoPlay src={playingUrl} style={{ width: "100%" }} />
        </div>
      )}

      {segments.length > 0 && (
        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "14px" }}>Chapters</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {segments.map((s) => (
              <div key={s.id} className="catalog-row" style={{ cursor: "default" }}>
                <div style={{ flex: 1 }}>
                  <div className="bname">Chapter {s.chapter_number}</div>
                  <div className="bstatus">
                    {STATUS_LABEL[s.status]}
                    {s.duration_estimate_seconds ? ` — ~${Math.round(s.duration_estimate_seconds / 60)} min (estimate)` : ""}
                    {s.error ? ` — ${s.error}` : ""}
                  </div>
                </div>
                {s.status === "generated" && (
                  <button className="btn btn-secondary" onClick={() => handlePlay(s.id)}>
                    ▶ Play
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p style={{ color: "var(--red)", fontSize: "13px", marginBottom: "14px" }}>{error}</p>}

      {job && job.status === "ready_for_review" && (
        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "10px" }}>Review Before Finishing</div>
          <p className="hint" style={{ marginBottom: "14px" }}>
            Listen to each chapter above. Marking this complete confirms you&apos;ve reviewed the narration — it
            does not publish or submit anything anywhere.
          </p>
          <button className="btn btn-primary" onClick={handleMarkComplete} disabled={completing}>
            {completing ? "Saving…" : "✓ Mark Reviewed &amp; Complete"}
          </button>
        </div>
      )}
    </>
  );
}

export default function AudiobookPage() {
  const router = useRouter();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sharedSecondaryCss }} />
      <header>
        <div className="logo">
          <span className="ink">Ink</span>
          <span className="frame">Frame</span>
        </div>
        <button className="back-btn" onClick={() => router.push("/dashboard")}>
          ← Back to Dashboard
        </button>
      </header>
      <div className="wrap">
        <h1>🎧 Audiobook Studio</h1>
        <p className="subtitle">Real narration from your approved chapters — you review every chapter before it counts as done.</p>
        <Suspense fallback={<p className="hint">Loading…</p>}>
          <AudiobookBody />
        </Suspense>
      </div>
    </>
  );
}

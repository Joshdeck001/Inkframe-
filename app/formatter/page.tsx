"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";
import { CURRENT_FORMATTER_VERSION } from "@/lib/document-model";

export const dynamic = "force-dynamic";

type FormattingJob = { id: string; output_formats: string[]; status: string; output_files: string[]; created_at: string; formatter_version: string | null };

export default function FormatterPage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);
  const [jobs, setJobs] = useState<FormattingJob[] | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [reformatting, setReformatting] = useState(false);
  const [reformatError, setReformatError] = useState<string | null>(null);
  const [reformatQueued, setReformatQueued] = useState(false);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setJobs(null);
      setReformatQueued(false);
      setReformatError(null);
      const { data } = await supabase
        .from("formatting_jobs")
        .select("id, output_formats, status, output_files, created_at, formatter_version")
        .eq("project_id", effectiveId)
        .order("created_at", { ascending: false });
      if (!cancelled) setJobs(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, supabase]);

  const latestJob = jobs?.[0] ?? null;
  // null formatter_version means this build predates real formatter
  // versioning entirely — always worth rebuilding with the corrected
  // architecture (see lib/document-model.ts's section-type classification).
  const isOutdated = !!latestJob && latestJob.formatter_version !== CURRENT_FORMATTER_VERSION;

  async function handleReformat() {
    if (!effectiveId) return;
    setReformatting(true);
    setReformatError(null);
    try {
      const res = await fetch("/api/reformat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: effectiveId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not queue a reformat.");
      setReformatQueued(true);
    } catch (e) {
      setReformatError(e instanceof Error ? e.message : "Could not queue a reformat.");
    } finally {
      setReformatting(false);
    }
  }

  async function handleDownload(format: "docx" | "epub") {
    if (!effectiveId) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/export-download?project=${effectiveId}&format=${format}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Download failed.");
      window.open(json.url, "_blank");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

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
        <h1>▦ Formatter</h1>
        <p className="subtitle">Upload your manuscript and let InkFrame format it — or check formatting jobs for a book you&apos;re already working on here.</p>

        <div className="panel" style={{ borderColor: "var(--blueGlow)", marginBottom: "24px" }}>
          <div style={{ fontWeight: 700, marginBottom: "8px" }}>⇧ Already wrote it somewhere else?</div>
          <p className="hint" style={{ marginBottom: "14px" }}>
            Upload a .docx, .txt, pasted text, or a ChatGPT conversation export — InkFrame preserves your exact
            words and formats it into a professional DOCX/EPUB, no rewriting.
          </p>
          <button className="btn btn-primary" onClick={() => router.push("/import")}>
            Upload Manuscript
          </button>
        </div>

        <div style={{ fontSize: "16px", fontWeight: 700, margin: "26px 0 10px" }}>Recent Formatting Projects</div>
        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && isOutdated && !reformatQueued && (
          <div className="panel" style={{ borderColor: "var(--yellow, #ffc266)", marginBottom: "20px" }}>
            <div style={{ fontWeight: 700, marginBottom: "8px" }}>⚠ Formatting update available</div>
            <p className="hint" style={{ marginBottom: "14px" }}>
              This book was formatted using an older version of InkFrame&apos;s formatting engine. Rebuild it using
              the current formatter to apply the latest structure and quality fixes — your manuscript content is
              never changed, only re-formatted from it. The previous formatted files stay available below.
            </p>
            <button className="btn btn-primary" onClick={handleReformat} disabled={reformatting}>
              {reformatting ? "Queuing…" : "Reformat Book"}
            </button>
            {reformatError && <p style={{ color: "var(--red)", fontSize: "13px", marginTop: "10px" }}>{reformatError}</p>}
          </div>
        )}
        {reformatQueued && (
          <div className="panel" style={{ borderColor: "var(--blueGlow)", marginBottom: "20px" }}>
            <p className="hint">
              Reformat queued — the next background formatting run will rebuild this book&apos;s DOCX/EPUB from its
              current manuscript content using the corrected formatter. Check back here in a few minutes.
            </p>
          </div>
        )}

        {effectiveId && (
          <div className="panel">
            {jobs === null && <p className="hint">Loading…</p>}
            {jobs && jobs.length === 0 && (
              <p className="hint">No formatting job yet for this book — it runs automatically once every chapter is quality-approved.</p>
            )}
            {jobs?.map((j) => (
              <div className="check-row" key={j.id}>
                <span>
                  {j.output_formats.join(", ") || "docx"}
                  {j.formatter_version && <span className="hint"> · formatter v{j.formatter_version}</span>}
                </span>
                <span className={j.status === "complete" ? "ok" : undefined}>{j.status.replace(/_/g, " ")}</span>
              </div>
            ))}
            {jobs?.some((j) => j.status === "complete" || j.status === "needs_attention") && (
              <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
                <button className="btn btn-primary" onClick={() => handleDownload("docx")} disabled={downloading}>
                  {downloading ? "Preparing…" : "Download (DOCX)"}
                </button>
                <button className="btn btn-primary" onClick={() => handleDownload("epub")} disabled={downloading}>
                  {downloading ? "Preparing…" : "Download (EPUB)"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

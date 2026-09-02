"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";

export const dynamic = "force-dynamic";

type FormattingJob = { id: string; output_formats: string[]; status: string; output_files: string[]; created_at: string };

export default function FormatterPage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);
  const [jobs, setJobs] = useState<FormattingJob[] | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setJobs(null);
      const { data } = await supabase
        .from("formatting_jobs")
        .select("id, output_formats, status, output_files, created_at")
        .eq("project_id", effectiveId)
        .order("created_at", { ascending: false });
      if (!cancelled) setJobs(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, supabase]);

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
        <p className="subtitle">Manuscript formatting jobs for your books. Each job produces both DOCX and EPUB — PDF isn&apos;t implemented yet.</p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && (
          <div className="panel">
            {jobs === null && <p className="hint">Loading…</p>}
            {jobs && jobs.length === 0 && (
              <p className="hint">No formatting job yet for this book — it runs automatically once every chapter is quality-approved.</p>
            )}
            {jobs?.map((j) => (
              <div className="check-row" key={j.id}>
                <span>{j.output_formats.join(", ") || "docx"}</span>
                <span className={j.status === "complete" ? "ok" : undefined}>{j.status}</span>
              </div>
            ))}
            {jobs?.some((j) => j.status === "complete") && (
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

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/job-progress";

export const dynamic = "force-dynamic";

// Blueprint, Writing, Quality, Cover, Images, Metadata, Compliance, Export
// (the DOCX Formatting Department produces) are all real and only ever
// marked done in the order they're actually run, driven by projects.status.
// Research is the odd one out — it runs once, synchronously, during the
// wizard's Step 8 (/api/research), before writing even starts, so it isn't
// tied to a pipeline status at all; its "done" state comes from whether
// research_notes rows actually exist for the project (see hasResearch below).
const PIPELINE = [
  { key: "blueprint", label: "Blueprint", icon: "✓", implemented: true },
  { key: "research", label: "Research", icon: "🔎", implemented: true },
  { key: "writing", label: "Writing", icon: "✎", implemented: true },
  { key: "quality", label: "Quality", icon: "◈", implemented: true },
  { key: "cover", label: "Cover", icon: "🎨", implemented: true },
  { key: "images", label: "Images", icon: "🖼", implemented: true },
  { key: "metadata", label: "Metadata", icon: "▤", implemented: true },
  { key: "compliance", label: "Compliance", icon: "✓", implemented: true },
  { key: "export", label: "Export", icon: "▦", implemented: true },
] as const;

function stageIndexForStatus(status: string): number {
  switch (status) {
    case "IDEA":
    case "BLUEPRINT":
    case "AWAITING_APPROVAL":
      return -1; // blueprint not yet done
    case "QUEUED":
      return 0; // blueprint done, nothing else started
    case "WRITING":
      return 2; // actively drafting chapters
    case "REVIEWING":
      return 3; // chapters written, Quality Loop actively scoring/revising
    case "GENERATING_COVER":
      return 4;
    case "GENERATING_IMAGES":
      return 5;
    case "GENERATING_METADATA":
      return 6;
    case "COMPLIANCE_CHECK":
      return 7;
    case "FORMATTING":
      return 8; // generating the DOCX
    case "READY_FOR_REVIEW":
    case "USER_APPROVED":
    case "READY_FOR_EXPORT":
    case "EXPORTED":
      return 9; // past the last real stage — everything implemented is done
    default:
      return -1;
  }
}

function taskTextForStatus(status: string): string {
  switch (status) {
    case "QUEUED":
      return "Queued — waiting for the Writing Agent to start.";
    case "WRITING":
      return "Writing chapters.";
    case "REVIEWING":
      return "Chapters drafted — running the Quality Loop.";
    case "GENERATING_COVER":
      return "Drafting cover concepts.";
    case "GENERATING_IMAGES":
      return "Deciding on interior image placements.";
    case "GENERATING_METADATA":
      return "Writing description, keywords, and categories.";
    case "COMPLIANCE_CHECK":
      return "Running platform compliance checks.";
    case "FORMATTING":
      return "Assembling the manuscript file.";
    case "READY_FOR_REVIEW":
    case "USER_APPROVED":
    case "READY_FOR_EXPORT":
    case "EXPORTED":
      return "Ready for your review — manuscript, cover concepts, metadata, and compliance checks are below.";
    default:
      return "Waiting on the Book Blueprint.";
  }
}

type ProjectData = {
  status: string;
  project_identity: { working_title: string | null; subtitle: string | null } | null;
  project_scope: { words_written: number | null; target_word_count: number | null } | null;
};

type MetadataData = {
  description_long: string | null;
  description_short: string | null;
  keywords: string[];
  categories: string[];
};

type CoverConcept = { prompt: string; rationale: string; status: string; image_ref: string | null };

type ComplianceCheck = { check_type: string; status: string; detail: string };

type ResearchNote = { research_type: string | null; content: string | null };

function JobProgressBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const supabase = createClient();

  const [project, setProject] = useState<ProjectData | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [loading, setLoading] = useState(!!projectId);
  const [metadata, setMetadata] = useState<MetadataData | null>(null);
  const [coverConcepts, setCoverConcepts] = useState<CoverConcept[]>([]);
  const [complianceChecks, setComplianceChecks] = useState<ComplianceCheck[]>([]);
  const [researchNotes, setResearchNotes] = useState<ResearchNote[]>([]);
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    document.title = pageTitle;
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    async function load() {
      const [{ data: proj }, { count }, { data: meta }, { data: cover }, { data: compliance }, { data: research }] = await Promise.all([
        supabase
          .from("projects")
          .select("status, project_identity(working_title, subtitle), project_scope(words_written, target_word_count)")
          .eq("id", projectId)
          .single(),
        supabase.from("chapters").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase
          .from("metadata_department")
          .select("description_long, description_short, keywords, categories")
          .eq("project_id", projectId)
          .maybeSingle(),
        supabase.from("cover_department").select("concepts").eq("project_id", projectId).maybeSingle(),
        supabase
          .from("compliance_checks")
          .select("check_type, status, detail")
          .eq("project_id", projectId)
          .order("checked_at", { ascending: false }),
        supabase
          .from("research_notes")
          .select("research_type, content")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false }),
      ]);
      if (!cancelled) {
        setProject((proj as unknown as ProjectData) ?? null);
        setChapterCount(count ?? 0);
        setMetadata(meta ?? null);
        setCoverConcepts((cover?.concepts as CoverConcept[] | undefined) ?? []);
        setComplianceChecks((compliance as ComplianceCheck[] | undefined) ?? []);
        setResearchNotes((research as ResearchNote[] | undefined) ?? []);
        setLoading(false);
      }
    }

    load();
    // Every department runs server-side on a cron schedule, independent of
    // this tab — poll only to reflect real progress while watching.
    const interval = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, supabase]);

  const status = project?.status ?? "BLUEPRINT";
  const stageIndex = stageIndexForStatus(status);
  const words = project?.project_scope?.words_written ?? 0;
  const targetWords = project?.project_scope?.target_word_count ?? 0;
  const pct = targetWords ? Math.min(100, Math.round((words / targetWords) * 100)) : status === "QUEUED" ? 8 : 2;
  const isReady = ["READY_FOR_REVIEW", "USER_APPROVED", "READY_FOR_EXPORT", "EXPORTED"].includes(status);

  async function handleDownload(format: "docx" | "epub") {
    if (!projectId) return;
    setDownloadState("loading");
    try {
      const res = await fetch(`/api/export-download?project=${projectId}&format=${format}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Download failed.");
      window.open(json.url, "_blank");
      setDownloadState("idle");
    } catch {
      setDownloadState("error");
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <header>
        <div className="logo">
          <span className="ink">Ink</span>
          <span className="frame">Frame</span>
        </div>
        <button className="leave-btn" onClick={() => router.push("/dashboard")}>
          Leave — I&apos;ll check back later
        </button>
      </header>

      <div className="wrap">
        <div
          className="status-pill"
          style={
            status === "QUEUED"
              ? { background: "rgba(255,180,50,.12)", color: "#ffc266" }
              : isReady
              ? { background: "rgba(40,200,140,.12)", color: "#5fe3b8" }
              : undefined
          }
        >
          <span className="pulse"></span> {status === "QUEUED" ? "QUEUED" : isReady ? "READY FOR REVIEW" : "AI WRITING AGENT"}
        </div>
        <h1>Your book is being prepared</h1>
        <p className="subtitle">
          You can safely close this tab. InkFrame keeps working in the background and updates your dashboard
          automatically.
        </p>

        {!projectId && (
          <div className="main-card">No project specified. Head back to your dashboard to pick one.</div>
        )}

        {projectId && loading && <div className="main-card">Loading…</div>}

        {projectId && !loading && project && (
          <div className="main-card">
            <div className="book-row">
              <div className="cover-mini" id="job-cover">
                IF
              </div>
              <div>
                <div className="book-title" id="job-title">
                  {project.project_identity?.working_title || "Untitled Project"}
                </div>
                <div className="book-sub" id="job-subtitle">
                  {project.project_identity?.subtitle || taskTextForStatus(status)}
                </div>
              </div>
            </div>

            <div className="progress-num">
              <span>
                Chapter <span className="big">{chapterCount}</span> of{" "}
                <span>{project.project_scope?.target_word_count ? "—" : "—"}</span>
              </span>
              <span>
                <span className="big">{words.toLocaleString()}</span> / {targetWords.toLocaleString()} words
              </span>
            </div>
            <div className="bar-outer">
              <div className="bar-inner" style={{ width: `${pct}%` }}></div>
            </div>

            <div className="pipeline">
              {PIPELINE.map((step, i) => {
                // Research isn't gated by projects.status at all (it runs once,
                // synchronously, during the wizard) — its done state comes from
                // whether research_notes rows actually exist, not stage index.
                const done =
                  step.key === "research"
                    ? researchNotes.length > 0
                    : step.implemented && (i < stageIndex || (i === stageIndex && status === "EXPORTED"));
                const active = step.key !== "research" && step.implemented && i === stageIndex && status !== "EXPORTED";
                return (
                  <div key={step.key} className={`pipe-step${done ? " done" : ""}${active ? " active" : ""}`}>
                    <div className="pipe-dot">{done ? "✓" : step.icon}</div>
                    <div className="pipe-label">{step.label}</div>
                  </div>
                );
              })}
            </div>

            <div className="task-row">
              <span className="lbl">Current status</span>
              <span className="val">{taskTextForStatus(status)}</span>
            </div>
            <div className="task-row">
              <span className="lbl">Chapters written</span>
              <span className="val">{chapterCount}</span>
            </div>
          </div>
        )}

        {metadata && (
          <div className="main-card">
            <div className="task-row" style={{ borderTop: "none", paddingTop: 0 }}>
              <span className="lbl" style={{ fontWeight: 700, color: "var(--ink)" }}>
                Metadata Department
              </span>
            </div>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6, margin: "6px 0 10px" }}>
              {metadata.description_long}
            </p>
            {metadata.keywords.length > 0 && (
              <p style={{ fontSize: "12px", color: "var(--muted)" }}>
                <strong style={{ color: "var(--ink)" }}>Keywords:</strong> {metadata.keywords.join(" · ")}
              </p>
            )}
            {metadata.categories.length > 0 && (
              <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                <strong style={{ color: "var(--ink)" }}>Categories:</strong> {metadata.categories.join(", ")}
              </p>
            )}
          </div>
        )}

        {coverConcepts.length > 0 && (
          <div className="main-card">
            <div className="task-row" style={{ borderTop: "none", paddingTop: 0 }}>
              <span className="lbl" style={{ fontWeight: 700, color: "var(--ink)" }}>
                Cover Department
              </span>
            </div>
            {coverConcepts.map((c, i) => (
              <div key={i} style={{ marginBottom: "10px", fontSize: "12.5px", color: "var(--muted)" }}>
                {c.image_ref && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.image_ref}
                    alt={`Cover concept ${i + 1}`}
                    style={{ maxWidth: "160px", width: "100%", borderRadius: "6px", display: "block", marginBottom: "6px" }}
                  />
                )}
                <strong style={{ color: "var(--ink)" }}>Concept {i + 1}:</strong> {c.prompt}
                <div style={{ fontSize: "11.5px", marginTop: "2px" }}>{c.rationale}</div>
              </div>
            ))}
          </div>
        )}

        {researchNotes.length > 0 && (
          <div className="main-card">
            <div className="task-row" style={{ borderTop: "none", paddingTop: 0 }}>
              <span className="lbl" style={{ fontWeight: 700, color: "var(--ink)" }}>
                Research
              </span>
            </div>
            {researchNotes.map((n, i) => (
              <div key={i} style={{ marginBottom: "10px", fontSize: "12.5px", color: "var(--muted)" }}>
                {n.research_type && (
                  <strong style={{ color: "var(--ink)" }}>{n.research_type.replace(/-/g, " ")}: </strong>
                )}
                {n.content}
              </div>
            ))}
          </div>
        )}

        {complianceChecks.length > 0 && (
          <div className="main-card">
            <div className="task-row" style={{ borderTop: "none", paddingTop: 0 }}>
              <span className="lbl" style={{ fontWeight: 700, color: "var(--ink)" }}>
                Compliance checks
              </span>
            </div>
            {complianceChecks.map((c, i) => (
              <div className="task-row" key={i}>
                <span className="lbl">{c.check_type.replace(/_/g, " ")}</span>
                <span
                  className="val"
                  style={{
                    color:
                      c.status === "pass"
                        ? "#5fe3b8"
                        : c.status === "action_required"
                        ? "#ff8595"
                        : "#ffc266",
                  }}
                  title={c.detail}
                >
                  {c.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="hint-box">
          ✦ InkFrame&apos;s Readiness Score and Quality checks are internal assessments to help you gauge
          manuscript strength — they are not a guarantee of platform acceptance or publication approval.
          You&apos;ll review everything before export.
        </div>

        <div className="actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>
            Back to Dashboard
          </button>
          {isReady ? (
            <>
              <button className="btn btn-secondary" onClick={() => handleDownload("docx")} disabled={downloadState === "loading"}>
                {downloadState === "loading" ? "Preparing…" : "Download (DOCX)"}
              </button>
              <button className="btn btn-secondary" onClick={() => handleDownload("epub")} disabled={downloadState === "loading"}>
                {downloadState === "loading" ? "Preparing…" : "Download (EPUB)"}
              </button>
              <button className="btn btn-primary" onClick={() => router.push(`/publish?project=${projectId}`)}>
                Continue to Publish →
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() =>
                alert(chapterCount > 0 ? "Opening manuscript viewer…" : "No chapters have been written yet.")
              }
            >
              View Manuscript So Far
            </button>
          )}
        </div>
        {downloadState === "error" && (
          <p style={{ color: "var(--red)", fontSize: "12.5px", textAlign: "center", marginTop: "8px" }}>
            Couldn&apos;t get a download link. Try again in a moment.
          </p>
        )}
      </div>
    </>
  );
}

export default function JobProgressPage() {
  return (
    <Suspense fallback={null}>
      <JobProgressBody />
    </Suspense>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/job-progress";

export const dynamic = "force-dynamic";

const PIPELINE = [
  { key: "blueprint", label: "Blueprint", icon: "✓" },
  { key: "research", label: "Research", icon: "🔎" },
  { key: "writing", label: "Writing", icon: "✎" },
  { key: "quality", label: "Quality", icon: "◈" },
  { key: "cover", label: "Cover", icon: "🎨" },
  { key: "metadata", label: "Metadata", icon: "▤" },
  { key: "compliance", label: "Compliance", icon: "✓" },
  { key: "export", label: "Export", icon: "▦" },
];

function stageIndexForStatus(status: string): number {
  switch (status) {
    case "IDEA":
    case "BLUEPRINT":
    case "AWAITING_APPROVAL":
      return -1; // blueprint not yet done
    case "QUEUED":
      return 0; // blueprint done, nothing else started
    case "RESEARCHING":
      return 1;
    case "WRITING":
    case "REVISING":
      return 2;
    case "REVIEWING":
      return 3;
    case "FORMATTING":
      return 3;
    case "GENERATING_COVER":
      return 4;
    case "GENERATING_METADATA":
      return 5;
    case "COMPLIANCE_CHECK":
      return 6;
    case "READY_FOR_REVIEW":
    case "USER_APPROVED":
    case "READY_FOR_EXPORT":
      return 6;
    case "EXPORTED":
      return 7;
    default:
      return -1;
  }
}

function taskTextForStatus(status: string): string {
  switch (status) {
    case "QUEUED":
      return "Queued — waiting for the Writing Agent to start.";
    case "RESEARCHING":
      return "Researching your topic/category.";
    case "WRITING":
      return "Writing chapters.";
    case "REVISING":
      return "Revising flagged chapters.";
    case "REVIEWING":
      return "Running the Quality Loop.";
    case "GENERATING_COVER":
      return "Designing your cover.";
    case "GENERATING_METADATA":
      return "Preparing description, keywords, and categories.";
    case "COMPLIANCE_CHECK":
      return "Running compliance checks.";
    case "READY_FOR_REVIEW":
    case "USER_APPROVED":
    case "READY_FOR_EXPORT":
      return "Ready — preparing export files.";
    case "EXPORTED":
      return "Done — your files are ready.";
    default:
      return "Waiting on the Book Blueprint.";
  }
}

type ProjectData = {
  status: string;
  project_identity: { working_title: string | null; subtitle: string | null } | null;
  project_scope: { words_written: number | null; target_word_count: number | null } | null;
};

function JobProgressBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const supabase = createClient();

  const [project, setProject] = useState<ProjectData | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [loading, setLoading] = useState(!!projectId);

  useEffect(() => {
    document.title = pageTitle;
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const [{ data: proj }, { count }] = await Promise.all([
        supabase
          .from("projects")
          .select("status, project_identity(working_title, subtitle), project_scope(words_written, target_word_count)")
          .eq("id", projectId)
          .single(),
        supabase.from("chapters").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      ]);
      if (!cancelled) {
        setProject((proj as unknown as ProjectData) ?? null);
        setChapterCount(count ?? 0);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, supabase]);

  const status = project?.status ?? "BLUEPRINT";
  const stageIndex = stageIndexForStatus(status);
  const words = project?.project_scope?.words_written ?? 0;
  const targetWords = project?.project_scope?.target_word_count ?? 0;
  const pct = targetWords ? Math.min(100, Math.round((words / targetWords) * 100)) : status === "QUEUED" ? 8 : 2;

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
        <div className="status-pill" style={status === "QUEUED" ? { background: "rgba(255,180,50,.12)", color: "#ffc266" } : undefined}>
          <span className="pulse"></span> {status === "QUEUED" ? "QUEUED" : "AI WRITING AGENT"}
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
              {PIPELINE.map((step, i) => (
                <div
                  key={step.key}
                  className={`pipe-step${i < stageIndex || (i === stageIndex && status === "EXPORTED") ? " done" : ""}${
                    i === stageIndex && status !== "EXPORTED" ? " active" : ""
                  }`}
                >
                  <div className="pipe-dot">{i <= stageIndex ? "✓" : step.icon}</div>
                  <div className="pipe-label">{step.label}</div>
                </div>
              ))}
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

        <div className="hint-box">
          ✦ InkFrame&apos;s Readiness Score and Quality checks are internal assessments to help you gauge
          manuscript strength — they are not a guarantee of platform acceptance or publication approval.
          You&apos;ll review everything before export.
        </div>

        <div className="actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>
            Back to Dashboard
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              alert(chapterCount > 0 ? "Opening manuscript viewer…" : "No chapters have been written yet.")
            }
          >
            View Manuscript So Far
          </button>
        </div>
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

"use client";

import { useRouter } from "next/navigation";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  IDEA: "Draft",
  BLUEPRINT: "Blueprint",
  AWAITING_APPROVAL: "Awaiting Approval",
  QUEUED: "Queued",
  WRITING: "Writing",
  REVIEWING: "Reviewing",
  GENERATING_COVER: "Generating Cover",
  GENERATING_METADATA: "Generating Metadata",
  COMPLIANCE_CHECK: "Compliance Check",
  FORMATTING: "Formatting",
  READY_FOR_REVIEW: "Ready for Review",
  USER_APPROVED: "Approved",
  READY_FOR_EXPORT: "Ready for Export",
  EXPORTED: "Published",
};

export default function BooksPage() {
  const router = useRouter();
  const projects = useMyProjects();

  function openProject(id: string, status: string) {
    if (["READY_FOR_REVIEW", "USER_APPROVED", "READY_FOR_EXPORT", "EXPORTED"].includes(status)) {
      router.push(`/publish?project=${id}`);
    } else if (status === "IDEA" || status === "BLUEPRINT" || status === "AWAITING_APPROVAL") {
      router.push("/wizard");
    } else {
      router.push(`/job-progress?project=${id}`);
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
        <h1>📚 My Books</h1>
        <p className="subtitle">Every book you&apos;ve started, in one place.</p>

        {projects && projects.length === 0 && (
          <div className="empty-panel">
            <div className="ei">📖</div>
            <h3>No books yet</h3>
            <p>Start your first book and it&apos;ll show up here.</p>
            <button className="btn btn-primary" onClick={() => router.push("/wizard")}>
              ＋ Create New Book
            </button>
          </div>
        )}

        {projects === null && <p className="hint">Loading…</p>}

        {projects && projects.length > 0 && (
          <div className="panel">
            {projects.map((p) => (
              <div className="catalog-row" key={p.id} onClick={() => openProject(p.id, p.status)}>
                <span className="status-dot none"></span>
                <div>
                  <div className="bname">{p.project_identity?.working_title || "Untitled Project"}</div>
                  <div className="bstatus">
                    {p.project_identity?.subtitle || ""} — {STATUS_LABEL[p.status] ?? p.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

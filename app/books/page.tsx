"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";

export const dynamic = "force-dynamic";

type Project = {
  id: string;
  status: string;
  updated_at: string;
  project_identity: { working_title: string | null; subtitle: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  IDEA: "Draft",
  BLUEPRINT: "Blueprint",
  AWAITING_APPROVAL: "Awaiting Approval",
  QUEUED: "Queued",
  WRITING: "Writing",
  REVIEWING: "Reviewing",
  GENERATING_COVER: "Generating Cover",
  GENERATING_IMAGES: "Generating Images",
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
  const supabase = createClient();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("projects")
        .select("id, status, updated_at, project_identity(working_title, subtitle)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (!cancelled) setProjects((data as unknown as Project[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function openProject(id: string, status: string) {
    if (["READY_FOR_REVIEW", "USER_APPROVED", "READY_FOR_EXPORT", "EXPORTED"].includes(status)) {
      router.push(`/publish?project=${id}`);
    } else if (status === "IDEA" || status === "BLUEPRINT" || status === "AWAITING_APPROVAL") {
      router.push(`/wizard?project=${id}`);
    } else {
      router.push(`/job-progress?project=${id}`);
    }
  }

  async function handleDelete(e: React.MouseEvent, project: Project) {
    e.stopPropagation();
    const title = project.project_identity?.working_title || "Untitled Project";
    if (!confirm(`Delete "${title}"? This permanently removes the book and everything InkFrame has generated for it — chapters, cover concepts, metadata, exports. This can't be undone.`)) {
      return;
    }
    setDeletingId(project.id);
    setError(null);
    const { error: deleteError } = await supabase.from("projects").delete().eq("id", project.id);
    setDeletingId(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setProjects((prev) => (prev ?? []).filter((p) => p.id !== project.id));
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

        {error && (
          <div className="panel" style={{ borderColor: "var(--red)" }}>
            <p className="hint" style={{ color: "var(--redGlow)" }}>{error}</p>
          </div>
        )}

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
                <div style={{ flex: 1 }}>
                  <div className="bname">{p.project_identity?.working_title || "Untitled Project"}</div>
                  <div className="bstatus">
                    {p.project_identity?.subtitle || ""} — {STATUS_LABEL[p.status] ?? p.status}
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  disabled={deletingId === p.id}
                  onClick={(e) => handleDelete(e, p)}
                >
                  {deletingId === p.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

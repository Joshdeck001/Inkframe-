"use client";

import type { MyProject } from "@/lib/useMyProjects";

export default function ProjectPicker({
  projects,
  selectedId,
  onSelect,
}: {
  projects: MyProject[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (projects === null) return <p className="hint">Loading your books…</p>;

  if (projects.length === 0) {
    return (
      <div className="empty-panel">
        <div className="ei">📖</div>
        <h3>No books yet</h3>
        <p>Create your first book to see it here.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      {projects.map((p) => (
        <div
          key={p.id}
          className={`catalog-row${selectedId === p.id ? " selected" : ""}`}
          onClick={() => onSelect(p.id)}
        >
          <span className="status-dot none"></span>
          <div>
            <div className="bname">{p.project_identity?.working_title || "Untitled Project"}</div>
            <div className="bstatus">
              {p.project_identity?.subtitle || ""} — {p.status.replace(/_/g, " ")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

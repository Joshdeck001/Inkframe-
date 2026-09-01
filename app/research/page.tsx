"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";

export const dynamic = "force-dynamic";

type ResearchNote = { id: string; research_type: string; content: string };
type TitleRisk = { status: string; notes: string | null; title_checked: string | null };

export default function ResearchPage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);
  const [notes, setNotes] = useState<ResearchNote[] | null>(null);
  const [titleRisk, setTitleRisk] = useState<TitleRisk | null>(null);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setNotes(null);
      setTitleRisk(null);
      const [{ data: noteRows }, { data: riskRows }] = await Promise.all([
        supabase.from("research_notes").select("id, research_type, content").eq("project_id", effectiveId),
        supabase
          .from("title_risk_checks")
          .select("status, notes, title_checked")
          .eq("project_id", effectiveId)
          .order("checked_at", { ascending: false })
          .limit(1),
      ]);
      if (!cancelled) {
        setNotes(noteRows ?? []);
        setTitleRisk(riskRows?.[0] ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, supabase]);

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
        <h1>🔎 Research</h1>
        <p className="subtitle">Title risk checks and category research for your books.</p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && (
          <>
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "8px" }}>Title Check</div>
              {titleRisk === null && notes === null && <p className="hint">Loading…</p>}
              {titleRisk === null && notes !== null && (
                <p className="hint">No title check has run yet — this happens automatically in the New Book wizard.</p>
              )}
              {titleRisk && (
                <>
                  <p style={{ fontSize: "13px" }}>{titleRisk.status.replace(/_/g, " ")}</p>
                  <p className="hint" style={{ marginTop: "6px" }}>{titleRisk.notes}</p>
                </>
              )}
            </div>
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "8px" }}>Category Research</div>
              {notes && notes.filter((n) => n.research_type === "genre").length === 0 && (
                <p className="hint">No category research yet.</p>
              )}
              {notes
                ?.filter((n) => n.research_type === "genre")
                .map((n) => (
                  <p key={n.id} style={{ fontSize: "13px", color: "var(--muted)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                    {n.content}
                  </p>
                ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

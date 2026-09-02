"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";

export const dynamic = "force-dynamic";

type CoverConcept = { prompt: string; rationale: string; status: string; image_ref: string | null };

export default function CoverDesignerPage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);
  const [concepts, setConcepts] = useState<CoverConcept[] | null>(null);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setConcepts(null);
      const { data } = await supabase.from("cover_department").select("concepts").eq("project_id", effectiveId).maybeSingle();
      if (!cancelled) setConcepts((data?.concepts as CoverConcept[] | undefined) ?? []);
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
        <h1>◈ Cover Designer</h1>
        <p className="subtitle">Cover concepts InkFrame drafted for your books.</p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && (
          <div className="panel">
            {concepts === null && <p className="hint">Loading…</p>}
            {concepts && concepts.length === 0 && (
              <p className="hint">
                No cover concepts yet for this book — they&apos;re generated automatically once all chapters
                are quality-approved.
              </p>
            )}
            {concepts?.map((c, i) => (
              <div key={i} style={{ marginBottom: "20px", fontSize: "13px" }}>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Concept {i + 1}</div>
                {c.image_ref && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.image_ref}
                    alt={`Cover concept ${i + 1}`}
                    style={{ maxWidth: "260px", width: "100%", borderRadius: "8px", display: "block", marginBottom: "8px" }}
                  />
                )}
                <div style={{ color: "var(--muted)" }}>{c.prompt}</div>
                <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "2px" }}>{c.rationale}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

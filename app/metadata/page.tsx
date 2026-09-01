"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";

export const dynamic = "force-dynamic";

type Metadata = {
  description_long: string | null;
  description_short: string | null;
  keywords: string[];
  categories: string[];
  bisac_codes: string[];
};

export default function MetadataPage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);
  const [metadata, setMetadata] = useState<Metadata | null | undefined>(undefined);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setMetadata(undefined);
      const { data } = await supabase
        .from("metadata_department")
        .select("description_long, description_short, keywords, categories, bisac_codes")
        .eq("project_id", effectiveId)
        .maybeSingle();
      if (!cancelled) setMetadata(data ?? null);
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
        <h1>🏷 Metadata</h1>
        <p className="subtitle">Description, keywords, and categories InkFrame generated for your books.</p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && (
          <div className="panel">
            {metadata === undefined && <p className="hint">Loading…</p>}
            {metadata === null && (
              <p className="hint">No metadata yet for this book — it&apos;s generated automatically once all chapters are quality-approved.</p>
            )}
            {metadata && (
              <>
                <div className="field">
                  <label>Description</label>
                  <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>{metadata.description_long}</p>
                </div>
                <div className="field">
                  <label>Keywords (7)</label>
                  <p style={{ fontSize: "13px", color: "var(--muted)" }}>{metadata.keywords.join(" · ")}</p>
                </div>
                <div className="field">
                  <label>Categories</label>
                  <p style={{ fontSize: "13px", color: "var(--muted)" }}>{metadata.categories.join(", ")}</p>
                </div>
                {metadata.bisac_codes.length > 0 && (
                  <div className="field">
                    <label>BISAC Codes</label>
                    <p style={{ fontSize: "13px", color: "var(--muted)" }}>{metadata.bisac_codes.join(", ")}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

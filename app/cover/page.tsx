"use client";

import { useEffect, useRef, useState } from "react";
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
  const [finalCoverRef, setFinalCoverRef] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadCover(projectId: string) {
    const { data } = await supabase.from("cover_department").select("concepts, final_cover_ref").eq("project_id", projectId).maybeSingle();
    setConcepts((data?.concepts as CoverConcept[] | undefined) ?? []);
    setFinalCoverRef(data?.final_cover_ref ?? null);
  }

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setConcepts(null);
      setFinalCoverRef(null);
      const { data } = await supabase.from("cover_department").select("concepts, final_cover_ref").eq("project_id", effectiveId).maybeSingle();
      if (!cancelled) {
        setConcepts((data?.concepts as CoverConcept[] | undefined) ?? []);
        setFinalCoverRef(data?.final_cover_ref ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, supabase]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !effectiveId) return;
    setUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append("project_id", effectiveId);
    formData.append("kind", "cover");
    formData.append("file", file);
    const res = await fetch("/api/upload-image", { method: "POST", body: formData });
    const json = await res.json();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!res.ok) {
      setUploadError(json.error || "Could not upload that image.");
      return;
    }
    await loadCover(effectiveId);
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
        <h1>◈ Cover Designer</h1>
        <p className="subtitle">Cover concepts InkFrame drafted for your books.</p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && (
          <div className="panel" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>Your Cover</div>
            {finalCoverRef ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={finalCoverRef}
                alt="Uploaded cover"
                style={{ maxWidth: "260px", width: "100%", borderRadius: "8px", display: "block", marginBottom: "10px" }}
              />
            ) : (
              <p className="hint" style={{ marginBottom: "10px" }}>
                No cover set yet — upload your own, or let a generated concept below be exported instead.
              </p>
            )}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} id="cover-upload-input" />
            <label htmlFor="cover-upload-input" className="btn btn-secondary" style={{ cursor: uploading ? "default" : "pointer", display: "inline-block" }}>
              {uploading ? "Uploading…" : finalCoverRef ? "Replace Cover" : "Upload Your Own Cover"}
            </label>
            {uploadError && <p className="hint" style={{ color: "var(--redGlow)", marginTop: "8px" }}>{uploadError}</p>}
            <p className="hint" style={{ marginTop: "8px", fontSize: "11.5px" }}>
              An uploaded cover always takes priority in your exported manuscript over the generated concepts below.
            </p>
          </div>
        )}

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

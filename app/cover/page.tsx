"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";
import { validateCover, type CoverValidationResult } from "@/lib/cover-validation";
import { STYLE_DIRECTION_LABELS, type StyleDirection } from "@/lib/cover-concepts";

export const dynamic = "force-dynamic";

type CoverConcept = {
  prompt: string;
  rationale: string;
  style_direction?: StyleDirection;
  status: string;
  image_ref: string | null;
  image_attempted?: boolean;
  version: number;
  parent_version: number | null;
  source: "generated" | "edited" | "user_uploaded";
  reference_image_ref?: string | null;
  edit_instructions?: string | null;
};

function CheckBadge({ status }: { status: "pass" | "warning" | "error" }) {
  const color = status === "pass" ? "#5fe3b8" : status === "warning" ? "#ffc266" : "var(--redGlow)";
  const icon = status === "pass" ? "✓" : status === "warning" ? "⚠" : "✕";
  return <span style={{ color, fontWeight: 700 }}>{icon}</span>;
}

export default function CoverDesignerPage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);

  const [concepts, setConcepts] = useState<CoverConcept[] | null>(null);
  const [finalCoverRef, setFinalCoverRef] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pageCount, setPageCount] = useState("");
  const [paperType, setPaperType] = useState("white");
  const [printCoverLoading, setPrintCoverLoading] = useState(false);
  const [printCoverError, setPrintCoverError] = useState<string | null>(null);
  const [printCoverResult, setPrintCoverResult] = useState<{ url: string; spine_width_in: number; full_wrap_width_in: number; full_wrap_height_in: number; spine_text_allowed: boolean } | null>(null);
  const [paperbackStatus, setPaperbackStatus] = useState<{ status: string | null; spineWidthIn: number | null; spineTextAllowed: boolean | null; needsRecalculation: boolean } | null>(null);

  const [conceptCount, setConceptCount] = useState("4");
  const [generatingConcepts, setGeneratingConcepts] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [editTargetVersion, setEditTargetVersion] = useState<number | null>(null);
  const [editInstructions, setEditInstructions] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [usage, setUsage] = useState<{ count: number; imageTokens: number; textTokens: number } | null>(null);

  async function loadCover(projectId: string) {
    const [{ data: cover }, { data: identity }, { data: editions }] = await Promise.all([
      supabase.from("cover_department").select("concepts, final_cover_ref").eq("project_id", projectId).maybeSingle(),
      supabase.from("project_identity").select("working_title, author_name, pen_name").eq("project_id", projectId).maybeSingle(),
      supabase.from("format_editions").select("id, format_type, status").eq("project_id", projectId).eq("format_type", "paperback").maybeSingle(),
    ]);
    setConcepts((cover?.concepts as CoverConcept[] | undefined) ?? []);
    setFinalCoverRef(cover?.final_cover_ref ?? null);
    setTitle(identity?.working_title ?? null);
    setAuthorName(identity?.pen_name || identity?.author_name || null);

    if (editions) {
      const { data: spec } = await supabase
        .from("cover_specs")
        .select("calculated_spine_width, needs_recalculation")
        .eq("format_edition_id", editions.id)
        .maybeSingle();
      setPaperbackStatus({
        status: editions.status,
        spineWidthIn: spec?.calculated_spine_width ?? null,
        spineTextAllowed: spec?.calculated_spine_width != null ? spec.calculated_spine_width > 0 : null,
        needsRecalculation: !!spec?.needs_recalculation,
      });
    } else {
      setPaperbackStatus(null);
    }

    const { data: logs } = await supabase.from("image_generation_log").select("status, image_tokens, text_tokens").eq("project_id", projectId);
    if (logs) {
      setUsage({
        count: logs.filter((l) => l.status === "success").length,
        imageTokens: logs.reduce((s, l) => s + (l.image_tokens ?? 0), 0),
        textTokens: logs.reduce((s, l) => s + (l.text_tokens ?? 0), 0),
      });
    }
  }

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setConcepts(null);
      setFinalCoverRef(null);
      if (!cancelled) await loadCover(effectiveId);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId]);

  // Background artwork generation (lib/cover-department.ts's tick) runs on
  // the shared cron schedule — poll while anything is still pending so
  // "Generate More Concepts" feels live without the user refreshing.
  useEffect(() => {
    if (!effectiveId || !concepts?.some((c) => !c.image_attempted)) return;
    const interval = setInterval(() => loadCover(effectiveId), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId, concepts]);

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

  async function handleUseConcept(imageRef: string) {
    if (!effectiveId) return;
    await supabase.from("cover_department").update({ final_cover_ref: imageRef, source: "generated" }).eq("project_id", effectiveId);
    setFinalCoverRef(imageRef);
  }

  async function handleGenerateConcepts() {
    if (!effectiveId) return;
    setGeneratingConcepts(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/cover/generate-concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: effectiveId, count: Number(conceptCount) || 4 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not draft new concepts.");
      await loadCover(effectiveId);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Could not draft new concepts.");
    } finally {
      setGeneratingConcepts(false);
    }
  }

  async function handleEditSubmit() {
    if (!effectiveId || !editInstructions.trim()) return;
    if (!editTargetVersion && !referenceFile) {
      setEditError("Select a concept to edit, or upload a reference image.");
      return;
    }
    setEditing(true);
    setEditError(null);
    try {
      let referencePath: string | null = null;
      if (referenceFile) {
        const formData = new FormData();
        formData.append("project_id", effectiveId);
        formData.append("file", referenceFile);
        const uploadRes = await fetch("/api/cover/upload-reference", { method: "POST", body: formData });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadJson.error || "Could not upload the reference image.");
        referencePath = uploadJson.path;
      }
      const res = await fetch("/api/cover/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: effectiveId,
          instructions: editInstructions.trim(),
          base_concept_version: editTargetVersion,
          reference_image_path: referencePath,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI cover editing failed.");
      setEditInstructions("");
      setReferenceFile(null);
      setEditTargetVersion(null);
      await loadCover(effectiveId);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "AI cover editing failed.");
    } finally {
      setEditing(false);
    }
  }

  async function handleGeneratePrintCover(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveId) return;
    setPrintCoverLoading(true);
    setPrintCoverError(null);
    setPrintCoverResult(null);
    try {
      const res = await fetch("/api/print-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: effectiveId, page_count: Number(pageCount), paper_type: paperType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not generate the print cover.");
      setPrintCoverResult(json);
      await loadCover(effectiveId);
    } catch (err) {
      setPrintCoverError(err instanceof Error ? err.message : "Could not generate the print cover.");
    } finally {
      setPrintCoverLoading(false);
    }
  }

  const validation: CoverValidationResult | null = concepts
    ? validateCover({
        hasSelectedArtwork: !!finalCoverRef,
        title,
        authorName,
        paperbackRequested: !!paperbackStatus,
        paperbackEditionStatus: paperbackStatus?.status ?? null,
        spineWidthIn: paperbackStatus?.spineWidthIn ?? null,
        spineTextAllowed: paperbackStatus?.spineTextAllowed ?? null,
        needsRecalculation: paperbackStatus?.needsRecalculation ?? false,
        printPdfGenerated: !!printCoverResult,
      })
    : null;

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
        <p className="subtitle">Real OpenAI-generated artwork, composed and validated by InkFrame — never a fake button.</p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && (
          <div className="panel" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>Your Cover</div>
            {finalCoverRef ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={finalCoverRef} alt="Selected cover" style={{ maxWidth: "260px", width: "100%", borderRadius: "8px", display: "block", marginBottom: "10px" }} />
            ) : (
              <p className="hint" style={{ marginBottom: "10px" }}>
                No cover selected yet — upload your own, or generate concepts below and pick one.
              </p>
            )}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} id="cover-upload-input" />
            <label htmlFor="cover-upload-input" className="btn btn-secondary" style={{ cursor: uploading ? "default" : "pointer", display: "inline-block" }}>
              {uploading ? "Uploading…" : finalCoverRef ? "Replace Cover" : "Upload Your Own Cover"}
            </label>
            {uploadError && <p className="hint" style={{ color: "var(--redGlow)", marginTop: "8px" }}>{uploadError}</p>}
          </div>
        )}

        {effectiveId && validation && (
          <div className="panel" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>
              Validation <CheckBadge status={validation.status} />
            </div>
            {validation.checks.map((c) => (
              <div className="check-row" key={c.id}>
                <span><CheckBadge status={c.status} /> {c.label}</span>
                <span style={{ fontSize: "12px", color: "var(--muted)", maxWidth: "60%", textAlign: "right" }}>{c.message}</span>
              </div>
            ))}
          </div>
        )}

        {effectiveId && (
          <div className="panel" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>Generate AI Cover Concepts</div>
            <p className="hint" style={{ marginBottom: "12px" }}>
              Drafts real, genuinely distinct art directions from what InkFrame already knows about this book
              (title, genre, audience, tone, any accepted research) — artwork then generates in the background;
              you can leave this page and come back.
            </p>
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>How many concepts</label>
                <input type="number" min={1} max={6} value={conceptCount} onChange={(e) => setConceptCount(e.target.value)} style={{ width: "90px" }} />
              </div>
              <button className="btn btn-primary" onClick={handleGenerateConcepts} disabled={generatingConcepts}>
                {generatingConcepts ? "Queuing…" : "Generate Cover Concepts"}
              </button>
            </div>
            {generateError && <p style={{ color: "var(--redGlow)", fontSize: "13px", marginTop: "10px" }}>{generateError}</p>}
          </div>
        )}

        {effectiveId && (
          <div className="panel" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>Edit With AI</div>
            <p className="hint" style={{ marginBottom: "10px" }}>
              Edit an existing concept&apos;s artwork, generate using an uploaded reference image, or both. Always
              creates a new version — nothing existing is overwritten.
            </p>
            <select value={editTargetVersion ?? ""} onChange={(e) => setEditTargetVersion(e.target.value ? Number(e.target.value) : null)} style={{ marginBottom: "10px" }}>
              <option value="">— Start from a reference image only —</option>
              {concepts?.filter((c) => c.image_ref).map((c) => (
                <option key={c.version} value={c.version}>
                  Concept v{c.version}{c.style_direction ? ` (${STYLE_DIRECTION_LABELS[c.style_direction]})` : ""}
                </option>
              ))}
            </select>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setReferenceFile(e.target.files?.[0] ?? null)} style={{ marginBottom: "10px", display: "block" }} />
            <textarea
              value={editInstructions}
              onChange={(e) => setEditInstructions(e.target.value)}
              placeholder="Describe the edit — e.g. 'extend the lighting and palette into a wider composition, keep the same character'"
              rows={2}
              style={{ width: "100%", background: "#0d1626", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "13px", fontFamily: "inherit", marginBottom: "10px" }}
            />
            <button className="btn btn-primary" onClick={handleEditSubmit} disabled={editing}>
              {editing ? "Editing…" : "Generate Edit"}
            </button>
            {editError && <p style={{ color: "var(--redGlow)", fontSize: "13px", marginTop: "10px" }}>{editError}</p>}
          </div>
        )}

        {effectiveId && finalCoverRef && (
          <div className="panel" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>Paperback Print Cover</div>
            <p className="hint" style={{ marginBottom: "12px" }}>
              Calculates the real spine width and full-wrap size from your exported manuscript&apos;s actual page
              count, then places your selected cover art into the front panel. InkFrame has no way to paginate a
              manuscript itself — open your exported DOCX in Word or Google Docs and enter the page count it
              shows you there, not an estimate.
            </p>
            <form onSubmit={handleGeneratePrintCover} style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Real page count (from Word)</label>
                <input type="number" min={24} value={pageCount} onChange={(e) => setPageCount(e.target.value)} required style={{ width: "140px" }} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Paper type</label>
                <select value={paperType} onChange={(e) => setPaperType(e.target.value)}>
                  <option value="white">White</option>
                  <option value="cream">Cream</option>
                  <option value="color">Standard/Premium Color</option>
                </select>
              </div>
              <button className="btn btn-primary" type="submit" disabled={printCoverLoading}>
                {printCoverLoading ? "Calculating…" : "Generate Print Cover"}
              </button>
            </form>
            {printCoverError && <p style={{ color: "var(--redGlow)", fontSize: "13px", marginTop: "10px" }}>{printCoverError}</p>}
            {printCoverResult && (
              <div style={{ marginTop: "14px", fontSize: "13px" }}>
                <div className="check-row">
                  <span>Spine width</span>
                  <span>{printCoverResult.spine_width_in}in</span>
                </div>
                <div className="check-row">
                  <span>Full wrap size</span>
                  <span>
                    {printCoverResult.full_wrap_width_in}in × {printCoverResult.full_wrap_height_in}in
                  </span>
                </div>
                <div className="check-row">
                  <span>Spine text</span>
                  <span>{printCoverResult.spine_text_allowed ? "Allowed" : "Too thin (under 100 pages)"}</span>
                </div>
                <a className="btn btn-secondary" style={{ display: "inline-block", marginTop: "10px" }} href={printCoverResult.url} target="_blank" rel="noreferrer">
                  ⇩ Download Print Cover PDF
                </a>
                <p className="hint" style={{ marginTop: "8px" }}>
                  The back cover and spine are a correctly-sized, labeled template — InkFrame doesn&apos;t have
                  back-cover copy or separate spine art to generate, so it never fakes that part as done. Hardcover
                  isn&apos;t offered yet for the same reason: no hardcover case-wrap template exists in InkFrame.
                </p>
              </div>
            )}
          </div>
        )}

        {effectiveId && usage && usage.count > 0 && (
          <div className="panel" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>AI Usage — This Book</div>
            <div className="check-row"><span>Successful generations</span><span>{usage.count}</span></div>
            {usage.imageTokens > 0 && <div className="check-row"><span>Image tokens (real, from the provider)</span><span>{usage.imageTokens.toLocaleString()}</span></div>}
            {usage.textTokens > 0 && <div className="check-row"><span>Text tokens (real, from the provider)</span><span>{usage.textTokens.toLocaleString()}</span></div>}
            <p className="hint" style={{ marginTop: "8px" }}>
              Real usage as reported by the provider — InkFrame doesn&apos;t estimate a dollar cost here since it
              can&apos;t verify current OpenAI pricing from this environment; check your OpenAI account&apos;s usage page for that.
            </p>
          </div>
        )}

        {effectiveId && (
          <div className="panel">
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>Concepts &amp; Versions</div>
            {concepts === null && <p className="hint">Loading…</p>}
            {concepts && concepts.length === 0 && (
              <p className="hint">No cover concepts yet — they&apos;re generated automatically once all chapters are quality-approved, or generate some above right now.</p>
            )}
            {concepts?.slice().sort((a, b) => b.version - a.version).map((c) => (
              <div key={c.version} style={{ marginBottom: "20px", fontSize: "13px", borderBottom: "1px solid var(--border)", paddingBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <div style={{ fontWeight: 600 }}>
                    v{c.version} {c.style_direction && `— ${STYLE_DIRECTION_LABELS[c.style_direction]}`}
                    {c.parent_version && <span className="hint"> (edited from v{c.parent_version})</span>}
                  </div>
                  <span className={`badge ${c.source === "user_uploaded" ? "active" : "user"}`}>{c.source.replace("_", " ")}</span>
                </div>
                {c.image_ref ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.image_ref} alt={`Cover concept v${c.version}`} style={{ maxWidth: "260px", width: "100%", borderRadius: "8px", display: "block", marginBottom: "8px" }} />
                    <button className="btn btn-secondary" style={{ marginBottom: "8px" }} onClick={() => handleUseConcept(c.image_ref!)} disabled={finalCoverRef === c.image_ref}>
                      {finalCoverRef === c.image_ref ? "✓ In Use" : "Use This Concept"}
                    </button>
                  </>
                ) : (
                  <p className="hint" style={{ marginBottom: "8px" }}>
                    {c.image_attempted ? "Artwork generation was attempted but unavailable — this stays a real prompt, not a fabricated image." : "Artwork generating in the background…"}
                  </p>
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

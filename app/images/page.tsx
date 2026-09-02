"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";

export const dynamic = "force-dynamic";

type Placement = {
  id: string;
  chapter_id: string | null;
  placement_location: string | null;
  prompt: string | null;
  status: string;
  file_ref: string | null;
};

type Chapter = { id: string; chapter_number: number; title: string | null };

type ImagesConfig = { image_workflow: string | null; auto_placement_enabled: boolean | null } | null;

export default function ImagesPage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);
  const [config, setConfig] = useState<ImagesConfig>(null);
  const [placements, setPlacements] = useState<Placement[] | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [uploadChapterId, setUploadChapterId] = useState("");
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const chapterNumbers = Object.fromEntries(chapters.map((c) => [c.id, c.chapter_number]));

  async function loadPlacements(projectId: string) {
    const { data } = await supabase
      .from("image_placements")
      .select("id, chapter_id, placement_location, prompt, status, file_ref")
      .eq("project_id", projectId);
    setPlacements((data as Placement[] | undefined) ?? []);
  }

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setConfig(null);
      setPlacements(null);
      setChapters([]);
      setUploadChapterId("");
      setUploadCaption("");
      const [{ data: configData }, { data: placementData }, { data: chapterData }] = await Promise.all([
        supabase.from("project_images").select("image_workflow, auto_placement_enabled").eq("project_id", effectiveId).maybeSingle(),
        supabase
          .from("image_placements")
          .select("id, chapter_id, placement_location, prompt, status, file_ref")
          .eq("project_id", effectiveId),
        supabase.from("chapters").select("id, chapter_number, title").eq("project_id", effectiveId).order("chapter_number", { ascending: true }),
      ]);
      if (cancelled) return;
      setConfig(configData ?? null);
      setPlacements((placementData as Placement[] | undefined) ?? []);
      const chapterList = (chapterData as Chapter[] | undefined) ?? [];
      setChapters(chapterList);
      if (chapterList.length > 0) setUploadChapterId(chapterList[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, supabase]);

  const wantsAutoImages =
    (config?.image_workflow === "Generate Automatically" || config?.image_workflow === "Mixed") &&
    config?.auto_placement_enabled === true;

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !effectiveId || !uploadChapterId) return;
    setUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append("project_id", effectiveId);
    formData.append("kind", "interior");
    formData.append("chapter_id", uploadChapterId);
    formData.append("placement_location", uploadCaption);
    formData.append("file", file);
    const res = await fetch("/api/upload-image", { method: "POST", body: formData });
    const json = await res.json();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!res.ok) {
      setUploadError(json.error || "Could not upload that image.");
      return;
    }
    setUploadCaption("");
    await loadPlacements(effectiveId);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await fetch("/api/upload-image", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeletingId(null);
    if (res.ok && effectiveId) await loadPlacements(effectiveId);
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
        <h1>🖼 Images</h1>
        <p className="subtitle">Interior illustrations for this book&apos;s chapters.</p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && config && config.image_workflow === "No Images" && (
          <p className="hint" style={{ marginBottom: "14px" }}>
            This book was set up with no interior images — you can still add your own below if you change your
            mind.
          </p>
        )}
        {effectiveId && config && config.image_workflow === "User Upload" && (
          <p className="hint" style={{ marginBottom: "14px" }}>
            This book is set to use your own images — add them below.
          </p>
        )}
        {effectiveId && config && config.image_workflow === "Generate Automatically" && !wantsAutoImages && (
          <p className="hint" style={{ marginBottom: "14px" }}>
            This book didn&apos;t ask InkFrame to recommend image placements automatically — you can still add
            your own below.
          </p>
        )}

        {effectiveId && chapters.length > 0 && (
          <div className="panel" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "10px" }}>Add Your Own Image</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <select
                value={uploadChapterId}
                onChange={(e) => setUploadChapterId(e.target.value)}
                style={{ padding: "10px", borderRadius: "8px", background: "var(--panel2, var(--panel))", color: "var(--text)", border: "1px solid var(--border)" }}
              >
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    Chapter {c.chapter_number}
                    {c.title ? `: ${c.title}` : ""}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={uploadCaption}
                onChange={(e) => setUploadCaption(e.target.value)}
                placeholder="Caption / placement note (optional)"
                style={{ padding: "10px", borderRadius: "8px", background: "var(--panel2, var(--panel))", color: "var(--text)", border: "1px solid var(--border)" }}
              />
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" />
              <button className="btn btn-primary" disabled={uploading} onClick={handleUpload} style={{ alignSelf: "flex-start" }}>
                {uploading ? "Uploading…" : "Upload Image"}
              </button>
              {uploadError && <p className="hint" style={{ color: "var(--redGlow)" }}>{uploadError}</p>}
            </div>
          </div>
        )}

        {effectiveId && (
          <div className="panel">
            {(config === null || placements === null) && <p className="hint">Loading…</p>}

            {config && placements && placements.length === 0 && (
              <p className="hint">No interior images yet for this book.</p>
            )}

            {placements?.map((p) => (
              <div key={p.id} style={{ marginBottom: "20px", fontSize: "13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                    Chapter {p.chapter_id ? (chapterNumbers[p.chapter_id] ?? "?") : "?"}
                    {p.placement_location ? ` — ${p.placement_location}` : ""}
                  </div>
                  {p.status === "uploaded" && (
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "4px 10px", fontSize: 11.5 }}
                      disabled={deletingId === p.id}
                      onClick={() => handleDelete(p.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {p.file_ref && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.file_ref}
                    alt={`Interior illustration for chapter ${p.chapter_id ? chapterNumbers[p.chapter_id] : ""}`}
                    style={{ maxWidth: "260px", width: "100%", borderRadius: "8px", display: "block", marginBottom: "8px" }}
                  />
                )}
                {p.prompt && <div style={{ color: "var(--muted)" }}>{p.prompt}</div>}
                {!p.prompt && p.status === "uploaded" && <div style={{ color: "var(--muted)" }}>Uploaded by you.</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

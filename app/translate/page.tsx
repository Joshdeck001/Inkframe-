"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/translate";

export const dynamic = "force-dynamic";

const LANGUAGES = [
  { lang: "Spanish", flag: "🇪🇸" },
  { lang: "German", flag: "🇩🇪" },
  { lang: "French", flag: "🇫🇷" },
  { lang: "Portuguese", flag: "🇵🇹" },
  { lang: "Italian", flag: "🇮🇹" },
  { lang: "Japanese", flag: "🇯🇵" },
  { lang: "Chinese", flag: "🇨🇳" },
  { lang: "Arabic", flag: "🇸🇦" },
];

type ProjectRow = {
  id: string;
  status: string;
  project_identity: { working_title: string | null; subtitle: string | null } | null;
};

type Source = { type: "project"; id: string; title: string } | { type: "upload"; path: string; filename: string };

export default function TranslatePage() {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState<"existing" | "upload">("existing");
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedLangs, setSelectedLangs] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    document.title = pageTitle;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("projects")
        .select("id, status, project_identity(working_title, subtitle)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (!cancelled) setProjects((data as unknown as ProjectRow[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function switchSource(which: "existing" | "upload") {
    setTab(which);
    setSource(null);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("uploads").upload(path, file);
      if (error) throw new Error(error.message);

      setSource({ type: "upload", path, filename: file.name });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function toggleLang(lang: string) {
    setSelectedLangs((langs) => (langs.includes(lang) ? langs.filter((l) => l !== lang) : [...langs, lang]));
  }

  async function startTranslation() {
    if (!source || selectedLangs.length === 0) return;
    setStarting(true);
    try {
      const { error } = await supabase.from("translation_jobs").insert({
        source_project_id: source.type === "project" ? source.id : null,
        source_file: source.type === "upload" ? source.path : null,
        target_languages: selectedLangs,
        status: "pending",
      });
      if (error) throw new Error(error.message);

      const label = source.type === "project" ? source.title : source.filename;
      alert(
        `InkFrame will now translate "${label}" into: ${selectedLangs.join(", ")}. This runs in the background — you can check progress from your dashboard.`
      );
      router.push("/dashboard");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not start translation.");
    } finally {
      setStarting(false);
    }
  }

  const canStart = !!source && selectedLangs.length > 0 && !starting;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />

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
        <h1>🌐 Translate a book</h1>
        <p className="subtitle">Title, subtitle, description, and the full manuscript get translated — not just the body text.</p>

        <div className="source-toggle">
          <div className={`source-btn${tab === "existing" ? " active" : ""}`} onClick={() => switchSource("existing")}>
            Select recent project
          </div>
          <div className={`source-btn${tab === "upload" ? " active" : ""}`} onClick={() => switchSource("upload")}>
            Upload manuscript
          </div>
        </div>

        {tab === "existing" && (
          <div className="panel">
            {projects === null && <p className="hint">Loading…</p>}
            {projects && projects.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px", color: "var(--muted)", fontSize: "13.5px" }}>
                No projects yet. Upload a manuscript instead, or create a book first.
              </div>
            )}
            {projects &&
              projects.map((p) => (
                <div
                  key={p.id}
                  className={`project-pick${source?.type === "project" && source.id === p.id ? " selected" : ""}`}
                  onClick={() => setSource({ type: "project", id: p.id, title: p.project_identity?.working_title || "Untitled Project" })}
                >
                  <div className="thumb"></div>
                  <div>
                    <div className="pname">{p.project_identity?.working_title || "Untitled Project"}</div>
                    <div className="pmeta">
                      {p.project_identity?.subtitle || ""} — {p.status}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {tab === "upload" && (
          <div className="panel">
            <label className="upload-box" htmlFor="file-upload">
              <div style={{ fontSize: "28px", marginBottom: "10px" }}>⬆</div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Click to upload your manuscript</div>
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>DOCX, PDF, or EPUB</div>
              <input
                type="file"
                id="file-upload"
                accept=".docx,.pdf,.epub"
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              />
            </label>
            {uploading && (
              <div style={{ marginTop: "12px", fontSize: "13px", color: "var(--blueGlow)" }}>Uploading…</div>
            )}
            {source?.type === "upload" && (
              <div style={{ marginTop: "12px", fontSize: "13px", color: "var(--blueGlow)" }}>✓ {source.filename}</div>
            )}
            {uploadError && <div style={{ marginTop: "12px", fontSize: "13px", color: "var(--red)" }}>{uploadError}</div>}
            <p className="hint" style={{ marginTop: "12px" }}>
              PDF/EPUB uploads are accepted, but text extraction is only implemented for DOCX so far — those jobs
              will show as failed for now.
            </p>
          </div>
        )}

        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "14px" }}>Translate into</div>
          <div className="lang-grid">
            {LANGUAGES.map(({ lang, flag }) => (
              <div
                key={lang}
                className={`lang-pill${selectedLangs.includes(lang) ? " selected" : ""}`}
                onClick={() => toggleLang(lang)}
              >
                <span className="flag">{flag}</span>
                {lang}
              </div>
            ))}
          </div>
          <p style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "10px" }}>
            Select more than one to generate multiple translated editions at once.
          </p>
        </div>

        <div className="disclosure-note">
          ⚠ AI-translated content must be disclosed the same way as AI-generated content on most platforms,
          including Amazon KDP. InkFrame flags this automatically in the Compliance Department for any translated
          edition.
        </div>

        <button className="btn" disabled={!canStart} onClick={startTranslation}>
          {starting ? "Starting…" : "Start Translation"}
        </button>
      </div>
    </>
  );
}

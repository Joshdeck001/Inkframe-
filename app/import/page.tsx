"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";

export const dynamic = "force-dynamic";

const BOOK_TYPES = [
  { value: "Fiction", label: "Fiction" },
  { value: "Nonfiction", label: "Nonfiction" },
  { value: "Biography", label: "Biography" },
  { value: "Memoir", label: "Memoir" },
  { value: "Self-help", label: "Self-help" },
  { value: "Educational", label: "Educational" },
  { value: "Technical/Professional", label: "Technical / Professional" },
  { value: "Children's", label: "Children's Book" },
  { value: "Serial Fiction", label: "Serial Fiction" },
  { value: "Other", label: "Other" },
];

const TRIM_SIZES = [
  { value: "6x9", label: "6 x 9 in — standard paperback (default)" },
  { value: "5x8", label: "5 x 8 in" },
  { value: "5.5x8.5", label: "5.5 x 8.5 in" },
  { value: "8.5x11", label: "8.5 x 11 in — guide / workbook" },
];

export default function ImportManuscriptPage() {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [bookType, setBookType] = useState("Nonfiction");
  const [trimSize, setTrimSize] = useState("6x9");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ chapters: number; words: number } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a .docx file first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title);
      formData.append("subtitle", subtitle);
      formData.append("author_name", authorName);
      formData.append("book_type", bookType);
      formData.append("trim_size", trimSize);

      const res = await fetch("/api/import-manuscript", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed.");
      setResult({ chapters: json.chapters, words: json.words });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setLoading(false);
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
        <h1>⇧ Import Manuscript</h1>
        <p className="subtitle">
          Already wrote it yourself? Upload it and InkFrame formats it into a professional DOCX/EPUB — no AI
          writing, no writing cost. Cover art, description, and compliance checks still run automatically.
        </p>

        {result ? (
          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "8px", color: "#5fe3b8" }}>
              ✓ Imported {result.chapters} chapter{result.chapters === 1 ? "" : "s"} ({result.words.toLocaleString()}{" "}
              words)
            </div>
            <p className="hint" style={{ marginBottom: "14px" }}>
              Cover art, metadata, compliance checks, and formatting are running now in the background — same as
              any other book.
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn btn-primary" onClick={() => router.push("/dashboard")}>
                Back to Dashboard
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setResult(null);
                  setFile(null);
                  setTitle("");
                  setSubtitle("");
                  setAuthorName("");
                }}
              >
                Import Another
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "14px" }}>Manuscript File</div>
              <label className="btn btn-secondary" style={{ cursor: "pointer", display: "inline-block" }}>
                {file ? file.name : "Choose .docx file"}
                <input
                  type="file"
                  accept=".docx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{ display: "none" }}
                />
              </label>
              <p className="hint" style={{ marginTop: "10px" }}>
                Only .docx is supported right now. If your chapters use Word&apos;s &quot;Heading 1&quot; style for
                each chapter title, InkFrame splits them automatically — otherwise the whole file is imported as
                one chapter.
              </p>
            </div>

            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "14px" }}>Book Details</div>
              <div className="field">
                <label>Working Title *</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="field">
                <label>Subtitle</label>
                <input type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
              </div>
              <div className="field">
                <label>Author Name</label>
                <input type="text" value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
              </div>
              <div className="field">
                <label>Book Type</label>
                <select value={bookType} onChange={(e) => setBookType(e.target.value)}>
                  {BOOK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Trim Size</label>
                <select value={trimSize} onChange={(e) => setTrimSize(e.target.value)}>
                  {TRIM_SIZES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && <p style={{ color: "var(--red)", fontSize: "13px", marginBottom: "14px" }}>{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Importing…" : "Import & Format"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}

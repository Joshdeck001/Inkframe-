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

type Source = "docx" | "txt" | "chatgpt_export";
type Chapter = { title: string; content: string; words: number };
type ConversationSummary = { index: number; title: string; assistantWords: number };
type Integrity = { sourceWords: number; sourceChars: number; assembledWords: number; assembledChars: number };
type Issues = {
  missingNumbers: number[];
  duplicates: { aIndex: number; bIndex: number }[];
  multipleVersions: { number: number; indices: number[] }[];
};

type Step = "source" | "upload" | "pickConversation" | "review" | "details" | "done";

export default function ImportManuscriptPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<Source | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [issues, setIssues] = useState<Issues | null>(null);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [bookType, setBookType] = useState("Nonfiction");
  const [trimSize, setTrimSize] = useState("6x9");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ chapters: number; words: number } | null>(null);

  function resolvedFile(): File | null {
    if (source === "txt" && !file && pastedText.trim()) {
      return new File([pastedText], "pasted.txt", { type: "text/plain" });
    }
    return file;
  }

  async function runParse(conversationIndex?: number) {
    const f = resolvedFile();
    if (!source || !f) {
      setError(source === "txt" ? "Paste some text or choose a .txt file first." : "Choose a file first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", f);
      formData.append("source", source);
      if (conversationIndex !== undefined) formData.append("conversation_index", String(conversationIndex));

      const res = await fetch("/api/import-manuscript/parse", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not read that file.");

      if (json.needsConversationPick) {
        setConversations(json.conversations);
        setStep("pickConversation");
        return;
      }
      setChapters(json.chapters);
      setIntegrity(json.integrity);
      setIssues(json.issues);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setLoading(false);
    }
  }

  function moveChapter(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= chapters.length) return;
    const next = [...chapters];
    [next[i], next[j]] = [next[j], next[i]];
    setChapters(next);
  }

  function renameChapter(i: number, newTitle: string) {
    const next = [...chapters];
    next[i] = { ...next[i], title: newTitle };
    setChapters(next);
  }

  function removeChapter(i: number) {
    setChapters(chapters.filter((_, idx) => idx !== i));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (chapters.length === 0) {
      setError("At least one chapter is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import-manuscript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapters: chapters.map((c) => ({ title: c.title, content: c.content })),
          title,
          subtitle,
          author_name: authorName,
          book_type: bookType,
          trim_size: trimSize,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed.");
      setResult({ chapters: json.chapters, words: json.words });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    setStep("source");
    setSource(null);
    setFile(null);
    setPastedText("");
    setConversations(null);
    setChapters([]);
    setIntegrity(null);
    setIssues(null);
    setResult(null);
    setError(null);
    setTitle("");
    setSubtitle("");
    setAuthorName("");
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
          Already wrote it yourself? Bring it into InkFrame and get professional DOCX/EPUB formatting — no AI
          writing, no rewriting, no writing cost. Cover art, description, and compliance checks still run
          automatically.
        </p>

        {step === "done" && result && (
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
              <button className="btn btn-secondary" onClick={startOver}>
                Import Another
              </button>
            </div>
          </div>
        )}

        {step === "source" && (
          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "14px" }}>What are you importing from?</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                className="catalog-row"
                style={{ width: "100%", textAlign: "left" }}
                onClick={() => {
                  setSource("docx");
                  setStep("upload");
                }}
              >
                <div>
                  <div className="bname">Upload a .docx file</div>
                  <div className="bstatus">
                    Chapter titles styled as Word&apos;s &quot;Heading 1&quot; are detected automatically.
                  </div>
                </div>
              </button>
              <button
                className="catalog-row"
                style={{ width: "100%", textAlign: "left" }}
                onClick={() => {
                  setSource("txt");
                  setStep("upload");
                }}
              >
                <div>
                  <div className="bname">Upload or paste plain text</div>
                  <div className="bstatus">
                    Recognizes headings like &quot;Chapter 1&quot;, &quot;CHAPTER ONE&quot;, &quot;Ch. 4&quot;.
                  </div>
                </div>
              </button>
              <button
                className="catalog-row"
                style={{ width: "100%", textAlign: "left" }}
                onClick={() => {
                  setSource("chatgpt_export");
                  setStep("upload");
                }}
              >
                <div>
                  <div className="bname">Import from a ChatGPT conversation</div>
                  <div className="bstatus">
                    Upload your own conversations.json export (ChatGPT → Settings → Data Controls → Export data).
                  </div>
                </div>
              </button>
            </div>
            <p className="hint" style={{ marginTop: "14px" }}>
              InkFrame never rewrites, paraphrases, or improves imported text. Chapters are marked approved
              immediately and skip the Writing Agent and Quality Loop entirely — you get exactly the words you
              brought in.
            </p>
          </div>
        )}

        {step === "upload" && source && (
          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "14px" }}>
              {source === "docx" && "Choose your .docx file"}
              {source === "txt" && "Paste your text, or choose a .txt file"}
              {source === "chatgpt_export" && "Choose your conversations.json export"}
            </div>

            {source === "txt" && (
              <div className="field">
                <textarea
                  className="mono"
                  style={{ minHeight: "220px" }}
                  placeholder="Paste your manuscript text here…"
                  value={pastedText}
                  onChange={(e) => {
                    setPastedText(e.target.value);
                    if (e.target.value) setFile(null);
                  }}
                />
              </div>
            )}

            <label className="btn btn-secondary" style={{ cursor: "pointer", display: "inline-block" }}>
              {file ? file.name : source === "docx" ? "Choose .docx file" : source === "txt" ? "Choose .txt file" : "Choose .json file"}
              <input
                type="file"
                accept={source === "docx" ? ".docx" : source === "txt" ? ".txt" : ".json"}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  if (e.target.files?.[0]) setPastedText("");
                }}
                style={{ display: "none" }}
              />
            </label>

            {source === "chatgpt_export" && (
              <p className="hint" style={{ marginTop: "10px" }}>
                This is your own official data export from OpenAI — not a link or login. In ChatGPT, go to
                Settings → Data Controls → Export data; OpenAI emails you a zip containing conversations.json.
                Upload that file here. Large exports can contain many unrelated conversations — you&apos;ll pick
                the one that has your book on the next screen.
              </p>
            )}
            {source === "docx" && (
              <p className="hint" style={{ marginTop: "10px" }}>
                If your chapters use Word&apos;s &quot;Heading 1&quot; style, they&apos;re split automatically.
                Otherwise InkFrame looks for heading patterns like &quot;Chapter 1&quot; in the text.
              </p>
            )}

            {error && <p style={{ color: "var(--red)", fontSize: "13px", margin: "14px 0 0" }}>{error}</p>}

            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button className="btn btn-primary" onClick={() => runParse()} disabled={loading}>
                {loading ? "Analyzing…" : "Analyze"}
              </button>
              <button className="btn btn-secondary" onClick={startOver} disabled={loading}>
                Back
              </button>
            </div>
          </div>
        )}

        {step === "pickConversation" && conversations && (
          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "6px" }}>Which conversation has your book?</div>
            <p className="hint" style={{ marginBottom: "14px" }}>
              This export contains {conversations.length} conversation{conversations.length === 1 ? "" : "s"} with
              assistant replies. Pick the one with your manuscript — InkFrame only reads the one you choose.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "360px", overflowY: "auto" }}>
              {conversations.map((c) => (
                <button
                  key={c.index}
                  className="catalog-row"
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => runParse(c.index)}
                  disabled={loading}
                >
                  <div>
                    <div className="bname">{c.title}</div>
                    <div className="bstatus">{c.assistantWords.toLocaleString()} words of assistant replies</div>
                  </div>
                </button>
              ))}
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: "13px", margin: "14px 0 0" }}>{error}</p>}
            <button className="btn btn-secondary" style={{ marginTop: "14px" }} onClick={startOver} disabled={loading}>
              Back
            </button>
          </div>
        )}

        {step === "review" && integrity && issues && (
          <>
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "14px" }}>Content Integrity Check</div>
              <div className="check-row">
                <span>Source words</span>
                <span>{integrity.sourceWords.toLocaleString()}</span>
              </div>
              <div className="check-row">
                <span>Assembled words</span>
                <span>{integrity.assembledWords.toLocaleString()}</span>
              </div>
              <div className="check-row">
                <span>Manuscript rewritten</span>
                <span className="ok">NO — extraction only</span>
              </div>
              <p className="hint" style={{ marginTop: "10px" }}>
                Assembled word count is normally a little lower than source — detected headings become chapter
                titles and are removed from the body, they aren&apos;t double-counted.
              </p>
            </div>

            {(issues.missingNumbers.length > 0 ||
              issues.duplicates.length > 0 ||
              issues.multipleVersions.length > 0) && (
              <div className="panel">
                <div style={{ fontWeight: 700, marginBottom: "10px" }}>⚠ Review Before Continuing</div>
                {issues.missingNumbers.length > 0 && (
                  <p style={{ fontSize: "13px", marginBottom: "8px" }}>
                    Possible missing chapter{issues.missingNumbers.length === 1 ? "" : "s"}: numbering skips{" "}
                    {issues.missingNumbers.join(", ")}. InkFrame will not invent them — check your source, or
                    continue without them.
                  </p>
                )}
                {issues.duplicates.map((d, i) => (
                  <p key={`d${i}`} style={{ fontSize: "13px", marginBottom: "8px" }}>
                    Possible duplicate: &quot;{chapters[d.aIndex]?.title}&quot; and &quot;{chapters[d.bIndex]?.title}
                    &quot; look identical. Remove one below if it is.
                  </p>
                ))}
                {issues.multipleVersions.map((v, i) => (
                  <p key={`v${i}`} style={{ fontSize: "13px", marginBottom: "8px" }}>
                    Multiple versions detected for Chapter {v.number}: {v.indices.map((idx) => `"${chapters[idx]?.title}"`).join(" and ")}
                    . This usually means a chapter was drafted, then rewritten as a follow-up — InkFrame kept both
                    rather than guess. Pick the one you want and remove the other below.
                  </p>
                ))}
              </div>
            )}

            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "14px" }}>
                Detected Chapters ({chapters.length}) — reorder, rename, or remove before formatting
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {chapters.map((c, i) => (
                  <div key={i} className="catalog-row" style={{ cursor: "default" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <button className="btn btn-secondary" style={{ padding: "2px 8px" }} onClick={() => moveChapter(i, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: "2px 8px" }}
                        onClick={() => moveChapter(i, 1)}
                        disabled={i === chapters.length - 1}
                      >
                        ↓
                      </button>
                    </div>
                    <div style={{ flex: 1 }}>
                      <input
                        type="text"
                        value={c.title}
                        onChange={(e) => renameChapter(i, e.target.value)}
                        style={{
                          width: "100%",
                          background: "#0d1626",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          padding: "8px 10px",
                          color: "#fff",
                          fontSize: "13px",
                          fontWeight: 600,
                        }}
                      />
                      <div className="bstatus" style={{ marginTop: "4px" }}>
                        {c.words.toLocaleString()} words
                      </div>
                    </div>
                    <button className="btn btn-secondary" onClick={() => removeChapter(i)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {error && <p style={{ color: "var(--red)", fontSize: "13px", margin: "14px 0 0" }}>{error}</p>}
              <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
                <button className="btn btn-primary" onClick={() => setStep("details")} disabled={chapters.length === 0}>
                  Continue to Book Details
                </button>
                <button className="btn btn-secondary" onClick={startOver}>
                  Start Over
                </button>
              </div>
            </div>
          </>
        )}

        {step === "details" && (
          <form onSubmit={handleCreate}>
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

            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? "Importing…" : "Import & Format"}
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => setStep("review")} disabled={loading}>
                Back to Chapters
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

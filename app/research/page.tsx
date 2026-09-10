"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";
import type { ResearchReport } from "@/lib/research-report";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type Stage = { key: string; label: string; status: "pending" | "passed" | "blocked" | "failed"; detail: string };
type SessionRow = {
  id: string;
  topic: string;
  mode: string;
  platforms: string[];
  status: "queued" | "running" | "completed" | "needs_attention" | "failed" | "cancelled";
  stages: Stage[];
  error: string | null;
  project_id: string | null;
  created_at: string;
};
type Concept = {
  concept: string;
  rationale: string[];
  competition_level: "low" | "medium" | "high";
  opportunity_level: "low" | "medium" | "high";
  recommended_format: string;
  series_recommendation: string | null;
  bundle_recommendation: string | null;
  confidence: "low" | "medium" | "high";
  status?: "pending" | "accepted" | "rejected" | "saved";
};
type ScoreDimension = { label: string; score: number; basis: string };
type Findings = {
  keyword_clusters: { label: string; keywords: string[] }[];
  frequency: { words: { term: string; occurrences: number; frequencyPct: number }[]; bigrams: { term: string; occurrences: number; frequencyPct: number }[]; trigrams: { term: string; occurrences: number; frequencyPct: number }[] };
  gaps: { theme: string; reason: string; supportingKeywords: string[] }[];
  opportunity_score: { overall: number; dimensions: ScoreDimension[]; disclaimer: string };
  concepts: Concept[];
  quality: { coveragePct?: number; evidenceQuality?: string; freshness?: string; confidence?: string; limitations?: string[] };
};

type Competitor = { id: string; title: string; author: string | null; price: number | null; rating: number | null; review_count: number | null; recurring_complaints: string | null; recurring_praise: string | null; content_gap: string | null; source_url: string | null; source_type: string };
type Keyword = { id: string; keyword: string; demand_signal: string | null; competition_signal: string | null; source_url: string | null; source_type: string };
type Category = { id: string; category_name: string; rationale: string | null; source_url: string | null; source_type: string };
type Note = { id: string; research_type: string; content: string; source_type: string };
type SavedReport = { id: string; sections: ResearchReport["sections"]; overall_assessment: string; confidence_level: string; evidence_summary: string; status: string; created_at: string };

const MODE_LABELS: Record<string, string> = {
  book_opportunity: "Book Opportunity",
  keyword_research: "Keyword Research",
  competition_analysis: "Competition Analysis",
  market_research: "Market Research",
  topic_research: "Topic Research",
  series_research: "Series Research",
  metadata_research: "Metadata Research",
  trend_research: "Trend Research",
  full_publishing_research: "Full Publishing Research",
};
const PLATFORM_LABELS: Record<string, string> = { amazon: "Amazon", google_play: "Google Play Books", kobo: "Kobo", web: "General Web" };
const ASSESSMENT_LABEL: Record<string, string> = {
  very_promising: "Very Promising", promising: "Promising", moderate: "Moderate",
  high_competition: "High Competition", difficult: "Difficult", insufficient_data: "Insufficient Data",
};
const SECTION_LABEL: Record<keyof ResearchReport["sections"], string> = {
  executive_summary: "Executive Summary",
  market_overview: "Market Overview",
  niche_assessment: "Niche Assessment",
  audience: "Audience",
  platform_analysis: "Platform Analysis",
  competitor_landscape: "Competitor Landscape",
  review_insights: "Reader Signals",
  market_gaps: "Content Gaps",
  keyword_opportunities: "Keyword Opportunities",
  keyword_frequency: "Keyword Frequency",
  title_patterns: "Title Patterns",
  category_opportunities: "Metadata / Category Recommendations",
  pricing_positioning: "Pricing / Positioning",
  trend_signals: "Trends",
  bundle_and_series_opportunities: "Bundle & Series Opportunities",
  risks: "Risks / Uncertainty",
  opportunities: "Recommended Book Ideas",
  recommended_angle: "Recommended Angle",
  differentiation_strategy: "Differentiation Strategy",
  next_actions: "Next Actions",
  final_recommendation: "Final Recommendation",
};

function StageList({ stages }: { stages: Stage[] }) {
  return (
    <div className="checklist-panel">
      {stages.map((s) => (
        <div className="check-row" key={s.key}>
          <span>{s.label}</span>
          <span style={{ color: s.status === "passed" ? "#5fe3b8" : s.status === "failed" || s.status === "blocked" ? "var(--red)" : "var(--muted)" }}>
            {s.status === "passed" ? "✓ done" : s.status === "failed" ? "✗ failed" : s.status === "blocked" ? "⚠ blocked" : "…pending"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScoreBar({ label, score, basis }: { label: string; score: number; basis: string }) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "3px" }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700 }}>{score}/100</span>
      </div>
      <div style={{ height: "6px", background: "rgba(255,255,255,.08)", borderRadius: "3px", overflow: "hidden", marginBottom: "3px" }}>
        <div style={{ height: "100%", width: `${score}%`, background: "var(--blueGlow)" }} />
      </div>
      <p className="hint" style={{ fontSize: "11.5px" }}>{basis}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence tables — shared by both a research session and a book project.
// The exact same competitor/keyword/category CRUD this page always had,
// generalized to take whichever scope column applies instead of forking
// the code per scope.
// ---------------------------------------------------------------------------

function EvidenceTables({ scopeColumn, scopeId, refreshKey }: { scopeColumn: "session_id" | "project_id"; scopeId: string; refreshKey: number }) {
  const supabase = createClient();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCompetitor, setNewCompetitor] = useState({ title: "", author: "", price: "", rating: "", review_count: "", recurring_complaints: "", recurring_praise: "", content_gap: "", source_url: "" });
  const [newKeyword, setNewKeyword] = useState({ keyword: "", demand_signal: "", competition_signal: "", source_url: "" });
  const [newCategory, setNewCategory] = useState({ category_name: "", rationale: "", source_url: "" });
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    const [{ data: c }, { data: k }, { data: cat }] = await Promise.all([
      supabase.from("competitor_research").select("*").eq(scopeColumn, scopeId).order("checked_at", { ascending: false }),
      supabase.from("keyword_research").select("*").eq(scopeColumn, scopeId).order("checked_at", { ascending: false }),
      supabase.from("category_research").select("*").eq(scopeColumn, scopeId).order("checked_at", { ascending: false }),
    ]);
    setCompetitors(c ?? []);
    setKeywords(k ?? []);
    setCategories(cat ?? []);
  }

  useEffect(() => {
    (async () => {
      await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, refreshKey]);

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!newCompetitor.title.trim()) return;
    const { error } = await supabase.from("competitor_research").insert({
      [scopeColumn]: scopeId,
      title: newCompetitor.title.trim(),
      author: newCompetitor.author.trim() || null,
      price: newCompetitor.price ? Number(newCompetitor.price) : null,
      rating: newCompetitor.rating ? Number(newCompetitor.rating) : null,
      review_count: newCompetitor.review_count ? parseInt(newCompetitor.review_count, 10) : null,
      recurring_complaints: newCompetitor.recurring_complaints.trim() || null,
      recurring_praise: newCompetitor.recurring_praise.trim() || null,
      content_gap: newCompetitor.content_gap.trim() || null,
      source_url: newCompetitor.source_url.trim() || null,
    });
    if (error) setError(error.message);
    else {
      setNewCompetitor({ title: "", author: "", price: "", rating: "", review_count: "", recurring_complaints: "", recurring_praise: "", content_gap: "", source_url: "" });
      await loadAll();
    }
  }

  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyword.keyword.trim()) return;
    const { error } = await supabase.from("keyword_research").insert({
      [scopeColumn]: scopeId,
      keyword: newKeyword.keyword.trim(),
      demand_signal: newKeyword.demand_signal.trim() || null,
      competition_signal: newKeyword.competition_signal.trim() || null,
      source_url: newKeyword.source_url.trim() || null,
    });
    if (error) setError(error.message);
    else {
      setNewKeyword({ keyword: "", demand_signal: "", competition_signal: "", source_url: "" });
      await loadAll();
    }
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategory.category_name.trim()) return;
    const { error } = await supabase.from("category_research").insert({
      [scopeColumn]: scopeId,
      category_name: newCategory.category_name.trim(),
      rationale: newCategory.rationale.trim() || null,
      source_url: newCategory.source_url.trim() || null,
    });
    if (error) setError(error.message);
    else {
      setNewCategory({ category_name: "", rationale: "", source_url: "" });
      await loadAll();
    }
  }

  async function removeRow(table: "competitor_research" | "keyword_research" | "category_research", id: string) {
    await supabase.from(table).delete().eq("id", id);
    await loadAll();
  }

  return (
    <>
      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "14px" }}>Competitors ({competitors.length})</div>
        <div style={{ overflowX: "auto", marginBottom: "16px" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th><th>Author</th><th>Price</th><th>Rating</th><th>Complaints / Praise</th><th>Source</th><th />
              </tr>
            </thead>
            <tbody>
              {competitors.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td>{c.author || "—"}</td>
                  <td>{c.price != null ? `$${c.price}` : "—"}</td>
                  <td>{c.rating != null ? `${c.rating}★ (${c.review_count ?? "?"} reviews)` : "—"}</td>
                  <td style={{ maxWidth: "220px", fontSize: "12px" }}>
                    {c.recurring_complaints && <div>⚠ {c.recurring_complaints}</div>}
                    {c.recurring_praise && <div>👍 {c.recurring_praise}</div>}
                  </td>
                  <td><span className={`badge ${c.source_type === "user_provided" ? "active" : "user"}`}>{c.source_type.replace("_", " ")}</span></td>
                  <td><button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => removeRow("competitor_research", c.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={addCompetitor} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <input placeholder="Book title *" value={newCompetitor.title} onChange={(e) => setNewCompetitor({ ...newCompetitor, title: e.target.value })} />
          <input placeholder="Author" value={newCompetitor.author} onChange={(e) => setNewCompetitor({ ...newCompetitor, author: e.target.value })} />
          <input placeholder="Price" value={newCompetitor.price} onChange={(e) => setNewCompetitor({ ...newCompetitor, price: e.target.value })} />
          <input placeholder="Rating (0-5)" value={newCompetitor.rating} onChange={(e) => setNewCompetitor({ ...newCompetitor, rating: e.target.value })} />
          <input placeholder="Review count" value={newCompetitor.review_count} onChange={(e) => setNewCompetitor({ ...newCompetitor, review_count: e.target.value })} />
          <input placeholder="Source URL" value={newCompetitor.source_url} onChange={(e) => setNewCompetitor({ ...newCompetitor, source_url: e.target.value })} />
          <input placeholder="Recurring complaints" value={newCompetitor.recurring_complaints} onChange={(e) => setNewCompetitor({ ...newCompetitor, recurring_complaints: e.target.value })} />
          <input placeholder="Recurring praise" value={newCompetitor.recurring_praise} onChange={(e) => setNewCompetitor({ ...newCompetitor, recurring_praise: e.target.value })} />
          <input placeholder="Apparent content gap" value={newCompetitor.content_gap} onChange={(e) => setNewCompetitor({ ...newCompetitor, content_gap: e.target.value })} style={{ gridColumn: "1 / -1" }} />
          <button className="btn btn-secondary" type="submit" style={{ gridColumn: "1 / -1" }}>+ Add Competitor</button>
        </form>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "14px" }}>Keywords ({keywords.length})</div>
        <div style={{ overflowX: "auto", marginBottom: "16px" }}>
          <table className="admin-table">
            <thead><tr><th>Keyword</th><th>Demand</th><th>Competition</th><th>Source</th><th /></tr></thead>
            <tbody>
              {keywords.map((k) => (
                <tr key={k.id}>
                  <td>{k.keyword}</td>
                  <td>{k.demand_signal || "DATA NOT AVAILABLE"}</td>
                  <td>{k.competition_signal || "DATA NOT AVAILABLE"}</td>
                  <td><span className={`badge ${k.source_type === "user_provided" ? "active" : "user"}`}>{k.source_type.replace("_", " ")}</span></td>
                  <td><button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => removeRow("keyword_research", k.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={addKeyword} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <input placeholder="Keyword *" value={newKeyword.keyword} onChange={(e) => setNewKeyword({ ...newKeyword, keyword: e.target.value })} />
          <input placeholder="Source URL" value={newKeyword.source_url} onChange={(e) => setNewKeyword({ ...newKeyword, source_url: e.target.value })} />
          <input placeholder="Demand signal (what you observed)" value={newKeyword.demand_signal} onChange={(e) => setNewKeyword({ ...newKeyword, demand_signal: e.target.value })} />
          <input placeholder="Competition signal" value={newKeyword.competition_signal} onChange={(e) => setNewKeyword({ ...newKeyword, competition_signal: e.target.value })} />
          <button className="btn btn-secondary" type="submit" style={{ gridColumn: "1 / -1" }}>+ Add Keyword</button>
        </form>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "14px" }}>Categories ({categories.length})</div>
        <div style={{ overflowX: "auto", marginBottom: "16px" }}>
          <table className="admin-table">
            <thead><tr><th>Category</th><th>Rationale</th><th>Source</th><th /></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.category_name}</td>
                  <td style={{ fontSize: "12px" }}>{c.rationale || "—"}</td>
                  <td><span className={`badge ${c.source_type === "user_provided" ? "active" : "user"}`}>{c.source_type.replace("_", " ")}</span></td>
                  <td><button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => removeRow("category_research", c.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={addCategory} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <input placeholder="Category name *" value={newCategory.category_name} onChange={(e) => setNewCategory({ ...newCategory, category_name: e.target.value })} />
          <input placeholder="Source URL" value={newCategory.source_url} onChange={(e) => setNewCategory({ ...newCategory, source_url: e.target.value })} />
          <input placeholder="Why it fits / competition notes" value={newCategory.rationale} onChange={(e) => setNewCategory({ ...newCategory, rationale: e.target.value })} style={{ gridColumn: "1 / -1" }} />
          <button className="btn btn-secondary" type="submit" style={{ gridColumn: "1 / -1" }}>+ Add Category</button>
        </form>
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Report generation + display — shared by session and project scopes.
// ---------------------------------------------------------------------------

function ReportsPanel({ generateBody, reports, onGenerated, onStatusChange }: {
  generateBody: { project_id: string } | { session_id: string };
  reports: SavedReport[];
  onGenerated: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/research/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(generateBody) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Report generation failed.");
      onGenerated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>Research Report</div>
        <p className="hint" style={{ marginBottom: "14px" }}>
          Synthesizes only the evidence and computed findings collected here — never invents competitors or
          numbers. Generating another report never overwrites a previous one.
        </p>
        <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating…" : "Generate Research Report"}
        </button>
        {error && <p style={{ color: "var(--red)", fontSize: "13px", marginTop: "10px" }}>{error}</p>}
      </div>

      {reports.map((r) => (
        <div className="panel" key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <div style={{ fontWeight: 700 }}>{ASSESSMENT_LABEL[r.overall_assessment] ?? r.overall_assessment}</div>
            <span className="badge user">{r.status.replace(/_/g, " ")}</span>
          </div>
          <div className="check-row"><span>Confidence</span><span>{r.confidence_level.replace(/_/g, " ")}</span></div>
          <p className="hint" style={{ margin: "10px 0" }}>{r.evidence_summary}</p>
          <div style={{ maxHeight: "320px", overflowY: "auto", marginTop: "10px" }}>
            {(Object.keys(SECTION_LABEL) as (keyof ResearchReport["sections"])[]).map((key) => (
              <div key={key} style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{SECTION_LABEL[key]}</div>
                <p style={{ fontSize: "13px", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{r.sections[key]}</p>
              </div>
            ))}
          </div>
          {r.status === "draft" && (
            <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
              <button className="btn btn-primary" onClick={() => onStatusChange(r.id, "accepted")}>Accept Recommendation</button>
              <button className="btn btn-secondary" onClick={() => onStatusChange(r.id, "needs_more_research")}>Research More</button>
              <button className="btn btn-secondary" onClick={() => onStatusChange(r.id, "rejected")}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// New Research form
// ---------------------------------------------------------------------------

function NewResearchForm({ onStarted }: { onStarted: (sessionId: string) => void }) {
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState("full_publishing_research");
  const [platforms, setPlatforms] = useState<string[]>(["amazon", "google_play", "kobo", "web"]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(discover: boolean) {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/research/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: discover ? "" : topic, mode, platforms }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not start research.");
      onStarted(json.session_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start research.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="panel">
      <div style={{ fontWeight: 700, marginBottom: "10px" }}>What are you researching?</div>
      <textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Enter a niche, topic, book idea, audience, or publishing question..."
        rows={2}
        style={{ width: "100%", background: "#0d1626", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", color: "#fff", fontSize: "13.5px", fontFamily: "inherit", marginBottom: "16px" }}
      />

      <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "8px" }}>Research Mode</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "16px" }}>
        {Object.entries(MODE_LABELS).map(([key, label]) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
            <input type="radio" name="mode" checked={mode === key} onChange={() => setMode(key)} />
            {label}
          </label>
        ))}
      </div>

      <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "8px" }}>Target Platforms</div>
      <div style={{ display: "flex", gap: "14px", marginBottom: "18px", flexWrap: "wrap" }}>
        {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={platforms.includes(key)}
              onChange={(e) => setPlatforms((prev) => (e.target.checked ? [...prev, key] : prev.filter((p) => p !== key)))}
            />
            {label}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => start(false)} disabled={starting || !topic.trim()}>
          {starting ? "Starting…" : "Start Research"}
        </button>
        <button className="btn btn-secondary" onClick={() => start(true)} disabled={starting}>
          {starting ? "Starting…" : "🔍 Find me promising book opportunities"}
        </button>
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: "13px", marginTop: "10px" }}>{error}</p>}

      <div className="safety-note" style={{ marginTop: "16px" }}>
        InkFrame investigates in real, verifiable stages — search discovery, evidence collection, keyword/gap
        analysis, opportunity scoring, then recommendations — and never bypasses a platform&apos;s login, CAPTCHA,
        or terms of service to gather data. Where live web search isn&apos;t configured, every finding is
        clearly labeled AI-inference, not live market data.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session detail
// ---------------------------------------------------------------------------

function SessionDetail({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [findings, setFindings] = useState<Findings | null>(null);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [evidenceRefresh, setEvidenceRefresh] = useState(0);
  const [creatingProjectFor, setCreatingProjectFor] = useState<number | null>(null);
  const [bookType, setBookType] = useState("Fiction");
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    const [{ data: s }, { data: f }, { data: r }, { data: n }] = await Promise.all([
      supabase.from("research_sessions").select("*").eq("id", sessionId).maybeSingle(),
      supabase.from("research_findings").select("*").eq("session_id", sessionId).maybeSingle(),
      supabase.from("research_reports").select("*").eq("session_id", sessionId).order("created_at", { ascending: false }),
      supabase.from("research_notes").select("id, research_type, content, source_type").eq("session_id", sessionId).order("created_at", { ascending: false }),
    ]);
    setSession(s as SessionRow);
    setFindings((f as Findings) ?? null);
    setReports(r ?? []);
    setNotes(n ?? []);
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!session || (session.status !== "queued" && session.status !== "running")) return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

  async function addNote() {
    if (!newNote.trim()) return;
    await supabase.from("research_notes").insert({ session_id: sessionId, research_type: "user_note", content: newNote.trim(), source_type: "user_provided" });
    setNewNote("");
    await load();
  }
  async function removeNote(id: string) {
    await supabase.from("research_notes").delete().eq("id", id);
    await load();
  }

  async function setConceptStatus(index: number, status: Concept["status"]) {
    if (!findings) return;
    const nextConcepts = findings.concepts.map((c, i) => (i === index ? { ...c, status } : c));
    setFindings({ ...findings, concepts: nextConcepts });
    await supabase.from("research_findings").update({ concepts: nextConcepts }).eq("session_id", sessionId);
  }

  async function createProject(index: number) {
    setCreatingProjectFor(index);
    setCreateError(null);
    try {
      const res = await fetch("/api/research/create-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, concept_index: index, book_type: bookType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create project.");
      router.push(`/wizard?project=${json.project_id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create project.");
    } finally {
      setCreatingProjectFor(null);
    }
  }

  if (!session) return <p className="hint">Loading session…</p>;

  const webSources = notes.filter((n) => n.research_type === "web_search");
  const userNotes = notes.filter((n) => n.research_type === "user_note");

  return (
    <>
      <button className="btn btn-secondary" style={{ marginBottom: "16px" }} onClick={onBack}>← Back to Research</button>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "16px" }}>{session.topic || "Open opportunity discovery"}</div>
            <div className="hint">{MODE_LABELS[session.mode] ?? session.mode} · {session.platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}</div>
          </div>
          <span className={`badge ${session.status === "completed" ? "active" : "user"}`}>{session.status.replace(/_/g, " ")}</span>
        </div>
        {session.project_id && (
          <p className="hint" style={{ marginTop: "6px" }}>
            Linked to a book project — accepted findings automatically inform Writing, Metadata, and Cover for it.{" "}
            <a href={`/passport?project=${session.project_id}`} style={{ color: "var(--blueGlow)" }}>Open Book Passport →</a>
          </p>
        )}
      </div>

      {(session.status === "queued" || session.status === "running") && (
        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "10px" }}>Researching…</div>
          <StageList stages={session.stages} />
          <p className="hint">Running in the background — you can leave this page and come back later.</p>
        </div>
      )}

      {session.status === "needs_attention" && (
        <div className="panel">
          <p style={{ color: "var(--red)", fontSize: "13px", marginBottom: "10px" }}>{session.error || "Research needs attention."}</p>
          <StageList stages={session.stages} />
          <button
            className="btn btn-primary"
            style={{ marginTop: "10px" }}
            onClick={async () => {
              await supabase.from("research_sessions").update({ status: "queued", error: null }).eq("id", sessionId);
              await load();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {findings && (
        <>
          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "4px" }}>Opportunity Score: {findings.opportunity_score.overall}/100</div>
            <p className="hint" style={{ marginBottom: "12px" }}>{findings.opportunity_score.disclaimer}</p>
            {findings.opportunity_score.dimensions?.map((d) => <ScoreBar key={d.label} label={d.label} score={d.score} basis={d.basis} />)}
          </div>

          {findings.quality && (
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>Research Quality</div>
              <div className="check-row"><span>Coverage</span><span>{findings.quality.coveragePct ?? "—"}%</span></div>
              <div className="check-row"><span>Evidence quality</span><span>{findings.quality.evidenceQuality ?? "—"}</span></div>
              <div className="check-row"><span>Freshness</span><span>{findings.quality.freshness ?? "—"}</span></div>
              <div className="check-row"><span>Confidence</span><span>{findings.quality.confidence ?? "—"}</span></div>
              {findings.quality.limitations && findings.quality.limitations.length > 0 && (
                <p className="hint" style={{ marginTop: "8px" }}>Limitations: {findings.quality.limitations.join(" ")}</p>
              )}
            </div>
          )}

          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "10px" }}>Keyword Clusters ({findings.keyword_clusters.length})</div>
            {findings.keyword_clusters.length === 0 && <p className="hint">None yet — add keyword evidence below.</p>}
            {findings.keyword_clusters.map((c) => (
              <div className="check-row" key={c.label}><span style={{ fontWeight: 600 }}>{c.label}</span><span style={{ fontSize: "12px", color: "var(--muted)" }}>{c.keywords.join(", ")}</span></div>
            ))}
          </div>

          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "10px" }}>Word / Phrase Frequency</div>
            {findings.frequency?.words?.slice(0, 10).map((f) => (
              <div className="check-row" key={f.term}><span>{f.term}</span><span>{f.occurrences} occurrence(s) · {f.frequencyPct}%</span></div>
            ))}
            {findings.frequency?.bigrams?.length > 0 && (
              <>
                <div style={{ fontWeight: 700, fontSize: "12px", marginTop: "10px", marginBottom: "6px" }}>Common phrases</div>
                {findings.frequency.bigrams.slice(0, 8).map((f) => (
                  <div className="check-row" key={f.term}><span>&quot;{f.term}&quot;</span><span>{f.occurrences} occurrence(s) · {f.frequencyPct}%</span></div>
                ))}
              </>
            )}
          </div>

          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "10px" }}>Content Gaps ({findings.gaps.length})</div>
            {findings.gaps.length === 0 && <p className="hint">No gaps detected yet from the evidence collected.</p>}
            {findings.gaps.map((g) => (
              <div key={g.theme} style={{ marginBottom: "10px" }}>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>{g.theme}</div>
                <p className="hint" style={{ fontSize: "12px" }}>{g.reason}</p>
              </div>
            ))}
          </div>

          <div className="panel">
            <div style={{ fontWeight: 700, marginBottom: "10px" }}>Recommended Opportunities ({findings.concepts.length})</div>
            <select value={bookType} onChange={(e) => setBookType(e.target.value)} style={{ marginBottom: "14px" }}>
              {["Fiction", "Nonfiction", "Biography", "Memoir", "Self-help", "Educational", "Technical/Professional", "Children's", "Serial Fiction", "Other"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {findings.concepts.length === 0 && <p className="hint">Concepts appear once the analysis and concept stages finish.</p>}
            {findings.concepts.map((c, i) => (
              <div key={i} className="checklist-panel" style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div style={{ fontWeight: 700 }}>Opportunity #{i + 1}: {c.concept}</div>
                  {c.status && c.status !== "pending" && <span className="badge active">{c.status}</span>}
                </div>
                <ul style={{ fontSize: "12.5px", color: "var(--muted)", marginBottom: "8px", paddingLeft: "18px" }}>
                  {c.rationale.map((r, j) => <li key={j}>{r}</li>)}
                </ul>
                <div className="check-row"><span>Competition</span><span style={{ textTransform: "capitalize" }}>{c.competition_level}</span></div>
                <div className="check-row"><span>Opportunity</span><span style={{ textTransform: "capitalize" }}>{c.opportunity_level}</span></div>
                <div className="check-row"><span>Recommended format</span><span>{c.recommended_format}</span></div>
                {c.series_recommendation && <div className="check-row"><span>Series</span><span>{c.series_recommendation}</span></div>}
                {c.bundle_recommendation && <div className="check-row"><span>Bundle</span><span>{c.bundle_recommendation}</span></div>}
                <div className="check-row"><span>Confidence</span><span style={{ textTransform: "capitalize" }}>{c.confidence}</span></div>

                <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                  <button className="btn btn-secondary" onClick={() => setConceptStatus(i, "accepted")}>Accept</button>
                  <button className="btn btn-secondary" onClick={() => setConceptStatus(i, "saved")}>Save for Later</button>
                  <button className="btn btn-secondary" onClick={() => setConceptStatus(i, "rejected")}>Reject</button>
                  {c.status === "accepted" && (
                    <button className="btn btn-primary" onClick={() => createProject(i)} disabled={creatingProjectFor === i}>
                      {creatingProjectFor === i ? "Creating…" : "Create Book Project"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {createError && <p style={{ color: "var(--red)", fontSize: "13px" }}>{createError}</p>}
          </div>
        </>
      )}

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>Sources ({webSources.length})</div>
        {webSources.length === 0 && <p className="hint">No live sources collected — see the safety note above for why.</p>}
        <div style={{ maxHeight: "220px", overflowY: "auto" }}>
          {webSources.map((n) => (
            <p key={n.id} style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "pre-wrap", marginBottom: "10px" }}>{n.content}</p>
          ))}
        </div>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>My Research Notes</div>
        <p className="hint" style={{ marginBottom: "10px" }}>Your own thinking — disagreements, rejected ideas, questions. Persists with this session.</p>
        {userNotes.map((n) => (
          <div className="check-row" key={n.id}>
            <span style={{ fontSize: "13px" }}>{n.content}</span>
            <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => removeNote(n.id)}>✕</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
          <input placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={addNote}>+ Add</button>
        </div>
      </div>

      <EvidenceTables scopeColumn="session_id" scopeId={sessionId} refreshKey={evidenceRefresh} />
      <button className="btn btn-secondary" onClick={() => setEvidenceRefresh((n) => n + 1)} style={{ marginBottom: "20px" }}>↻ Refresh evidence</button>

      <ReportsPanel
        generateBody={{ session_id: sessionId }}
        reports={reports}
        onGenerated={load}
        onStatusChange={async (id, status) => {
          await supabase.from("research_reports").update({ status }).eq("id", id);
          await load();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview / history
// ---------------------------------------------------------------------------

function Overview({ onSelect, onNew }: { onSelect: (id: string) => void; onNew: () => void }) {
  const supabase = createClient();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("research_sessions")
        .select("id, topic, mode, platforms, status, stages, error, project_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!cancelled) setSessions((data as SessionRow[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <div style={{ fontWeight: 700 }}>Research History</div>
        <button className="btn btn-primary" onClick={onNew}>+ New Research</button>
      </div>
      {sessions === null && <p className="hint">Loading…</p>}
      {sessions && sessions.length === 0 && <p className="hint">No research sessions yet — start one above.</p>}
      {sessions?.map((s) => (
        <div className="check-row" key={s.id} style={{ cursor: "pointer" }} onClick={() => onSelect(s.id)}>
          <span>{s.topic || "Open opportunity discovery"} <span className="hint">({MODE_LABELS[s.mode] ?? s.mode})</span></span>
          <span className={s.status === "completed" ? "ok" : undefined}>{s.status.replace(/_/g, " ")}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy: research tied to an existing book project (unchanged behavior,
// now sharing EvidenceTables/ReportsPanel instead of duplicating them).
// ---------------------------------------------------------------------------

function ProjectResearch() {
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [evidenceRefresh, setEvidenceRefresh] = useState(0);

  async function loadReports() {
    if (!effectiveId) return;
    const { data } = await supabase.from("research_reports").select("*").eq("project_id", effectiveId).order("created_at", { ascending: false });
    setReports(data ?? []);
  }

  useEffect(() => {
    (async () => {
      await loadReports();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId]);

  return (
    <>
      <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />
      {effectiveId && (
        <>
          <EvidenceTables scopeColumn="project_id" scopeId={effectiveId} refreshKey={evidenceRefresh} />
          <button className="btn btn-secondary" onClick={() => setEvidenceRefresh((n) => n + 1)} style={{ marginBottom: "20px" }}>↻ Refresh evidence</button>
          <ReportsPanel
            generateBody={{ project_id: effectiveId }}
            reports={reports}
            onGenerated={loadReports}
            onStatusChange={async (id, status) => {
              await supabase.from("research_reports").update({ status }).eq("id", id);
              await loadReports();
            }}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResearchPage() {
  const router = useRouter();
  const [view, setView] = useState<"overview" | "new" | "session">("overview");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showProjectResearch, setShowProjectResearch] = useState(false);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sharedSecondaryCss }} />
      <header>
        <div className="logo"><span className="ink">Ink</span><span className="frame">Frame</span></div>
        <button className="back-btn" onClick={() => router.push("/dashboard")}>← Back to Dashboard</button>
      </header>
      <div className="wrap">
        <h1>🔎 Research</h1>
        <p className="subtitle">
          What should you create, for whom, and why — investigated in real, evidence-tagged stages, never a
          guess generator. Nothing here creates or publishes a book on its own; you review and approve every step.
        </p>

        {view === "overview" && (
          <>
            <Overview
              onSelect={(id) => {
                setActiveSessionId(id);
                setView("session");
              }}
              onNew={() => setView("new")}
            />
            <button className="btn btn-secondary" style={{ margin: "20px 0" }} onClick={() => setShowProjectResearch((v) => !v)}>
              {showProjectResearch ? "Hide" : "Show"} research tied to an existing book project
            </button>
            {showProjectResearch && <ProjectResearch />}
          </>
        )}

        {view === "new" && (
          <>
            <button className="btn btn-secondary" style={{ marginBottom: "16px" }} onClick={() => setView("overview")}>← Back to Research</button>
            <NewResearchForm
              onStarted={(id) => {
                setActiveSessionId(id);
                setView("session");
              }}
            />
          </>
        )}

        {view === "session" && activeSessionId && <SessionDetail sessionId={activeSessionId} onBack={() => setView("overview")} />}
      </div>
    </>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";
import type { ResearchReport } from "@/lib/research-report";
import { classifyEvidence } from "@/lib/research-evidence-labels";
import { groupClipsByCanonicalBook, buildObservedSeries } from "@/lib/scout-matching";
import { computeOpportunitySignals, scanMarket, type OpportunitySignals, type MarketScanResult } from "@/lib/scout-opportunity";
import { computeEvidenceCompleteness, computeFreshness, computeEvidenceQuality } from "@/lib/scout-evidence";

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
  platform_breakdown: { platform: string; competitorCount: number; keywordCount: number; keywordsWithDemandSignal: number; hasEvidence: boolean }[];
  keyword_intelligence: { keyword: string; intent: string; specificityScore: number; hasDemandEvidence: boolean; hasCompetitionEvidence: boolean }[];
  coverage_matrix: { competitor: string; covered: Record<string, boolean> }[];
};

type Competitor = { id: string; title: string; author: string | null; price: number | null; rating: number | null; review_count: number | null; recurring_complaints: string | null; recurring_praise: string | null; content_gap: string | null; source_url: string | null; source_type: string; confidence: string | null };
type Keyword = { id: string; keyword: string; demand_signal: string | null; competition_signal: string | null; source_url: string | null; source_type: string; confidence: string | null };
type Category = { id: string; category_name: string; rationale: string | null; source_url: string | null; source_type: string; confidence: string | null };
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
  amazon_analysis: "Amazon Analysis",
  google_analysis: "Google Play Analysis",
  kobo_analysis: "Kobo Analysis",
  platform_scorecard: "Cross-Platform Scorecard",
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
  chief_research_conclusion: "Chief Research Conclusion",
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
  const [newCompetitor, setNewCompetitor] = useState({ title: "", author: "", price: "", rating: "", review_count: "", recurring_complaints: "", recurring_praise: "", content_gap: "", source_url: "", platform: "" });
  const [newKeyword, setNewKeyword] = useState({ keyword: "", demand_signal: "", competition_signal: "", source_url: "", platform: "" });
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
      platform: newCompetitor.platform || null,
    });
    if (error) setError(error.message);
    else {
      setNewCompetitor({ title: "", author: "", price: "", rating: "", review_count: "", recurring_complaints: "", recurring_praise: "", content_gap: "", source_url: "", platform: "" });
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
      platform: newKeyword.platform || null,
    });
    if (error) setError(error.message);
    else {
      setNewKeyword({ keyword: "", demand_signal: "", competition_signal: "", source_url: "", platform: "" });
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
                  <td><span className={`badge ${c.source_type === "user_provided" ? "active" : "user"}`} title={classifyEvidence(c.source_type, c.confidence)}>{c.source_type.replace("_", " ")}</span></td>
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
          <select value={newCompetitor.platform} onChange={(e) => setNewCompetitor({ ...newCompetitor, platform: e.target.value })} style={{ gridColumn: "1 / -1" }}>
            <option value="">Where did you find this? (optional, powers cross-platform intelligence)</option>
            {Object.entries(PLATFORM_LABELS).filter(([k]) => k !== "web").map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
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
                  <td><span className={`badge ${k.source_type === "user_provided" ? "active" : "user"}`} title={classifyEvidence(k.source_type, k.confidence)}>{k.source_type.replace("_", " ")}</span></td>
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
          <select value={newKeyword.platform} onChange={(e) => setNewKeyword({ ...newKeyword, platform: e.target.value })} style={{ gridColumn: "1 / -1" }}>
            <option value="">Where did you find this? (optional, powers cross-platform intelligence)</option>
            {Object.entries(PLATFORM_LABELS).filter(([k]) => k !== "web").map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
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
                  <td><span className={`badge ${c.source_type === "user_provided" ? "active" : "user"}`} title={classifyEvidence(c.source_type, c.confidence)}>{c.source_type.replace("_", " ")}</span></td>
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

          {findings.platform_breakdown?.some((p) => p.hasEvidence) && (
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Cross-Platform Evidence</div>
              <p className="hint" style={{ marginBottom: "10px" }}>Only counts platforms with real tagged evidence — a platform with none isn&apos;t shown here at all.</p>
              {findings.platform_breakdown.filter((p) => p.hasEvidence).map((p) => (
                <div className="check-row" key={p.platform}>
                  <span>{PLATFORM_LABELS[p.platform] ?? p.platform}</span>
                  <span>{p.competitorCount} competitor(s), {p.keywordCount} keyword(s) ({p.keywordsWithDemandSignal} with demand evidence)</span>
                </div>
              ))}
            </div>
          )}

          {findings.keyword_intelligence?.length > 0 && (
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>Keyword Intelligence</div>
              <div style={{ overflowX: "auto" }}>
                <table className="admin-table">
                  <thead><tr><th>Keyword</th><th>Intent</th><th>Specificity</th><th>Demand evidence</th><th>Competition evidence</th></tr></thead>
                  <tbody>
                    {findings.keyword_intelligence.map((k) => (
                      <tr key={k.keyword}>
                        <td>{k.keyword}</td>
                        <td style={{ textTransform: "capitalize" }}>{k.intent.replace(/_/g, " ")}</td>
                        <td>{k.specificityScore}/100</td>
                        <td>{k.hasDemandEvidence ? "✓" : "—"}</td>
                        <td>{k.hasCompetitionEvidence ? "✓" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {findings.coverage_matrix?.length > 0 && (
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Content-Depth Coverage</div>
              <p className="hint" style={{ marginBottom: "10px" }}>Real substring matches against each competitor&apos;s own recorded strengths/gap text — never a guess at what a book probably covers.</p>
              <div style={{ overflowX: "auto" }}>
                <table className="admin-table">
                  <thead><tr><th>Competitor</th><th>Beginner</th><th>Setup</th><th>Intermediate</th><th>Troubleshooting</th><th>Advanced</th></tr></thead>
                  <tbody>
                    {findings.coverage_matrix.map((row) => (
                      <tr key={row.competitor}>
                        <td>{row.competitor}</td>
                        {["beginner", "setup", "intermediate", "troubleshooting", "advanced"].map((area) => (
                          <td key={area}>{row.covered[area] ? "✓" : "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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

type ScoutClip = {
  id: string;
  marketplace: string;
  title: string | null;
  author: string | null;
  publisher: string | null;
  source_url: string;
  external_id: string | null;
  isbn: string | null;
  price: number | null;
  bsr: number | null;
  category: string | null;
  category_rank: number | null;
  rating: number | null;
  review_count: number | null;
  published_date: string | null;
  clipped_at: string;
  status: string;
  snapshot_id: string | null;
};

type ScoutSnapshot = { id: string; label: string };
type CompetitionSet = { id: string; label: string };
type CompetitionSetClipRow = { competition_set_id: string; clip_id: string };
type WatchedBook = { id: string; isbn: string | null; marketplace: string | null; external_id: string | null; title: string | null; author: string | null };
type ScoutOpportunity = {
  id: string;
  title: string;
  market: string | null;
  competition_set_id: string | null;
  session_id: string | null;
  project_id: string | null;
  score: OpportunitySignals | null;
  potential_audience: string | null;
  potential_positioning: string | null;
  potential_differentiation: string | null;
  risks: string | null;
  status: string;
};

function platformLabel(marketplace: string): string {
  return PLATFORM_LABELS[marketplace === "google_play_books" ? "google_play" : marketplace] ?? marketplace;
}

function CrossPlatformInsights({ clips }: { clips: ScoutClip[] }) {
  const matches = groupClipsByCanonicalBook(clips);
  const priceHistory = buildObservedSeries(clips, "price");
  const bsrHistory = buildObservedSeries(clips, "bsr");
  if (matches.length === 0 && priceHistory.length === 0 && bsrHistory.length === 0) return null;

  return (
    <div className="checklist-panel" style={{ marginBottom: "14px" }}>
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>Cross-Platform & Historical Insights</div>
      <p className="hint" style={{ marginBottom: "10px" }}>
        CALCULATED — computed only from clips you&apos;ve already captured, no live lookups, no estimates.
      </p>
      {matches.map((g) => (
        <div key={g.key} className="check-row" style={{ alignItems: "flex-start" }}>
          <span>
            {g.confidence === "high" ? "Same book (ISBN match): " : "Possible same book (title/author match, unconfirmed): "}
            {g.clips.map((c) => `${platformLabel(c.marketplace)}${c.price != null ? ` $${c.price}` : ""}`).join(" · ")}
          </span>
        </div>
      ))}
      {priceHistory.map((h) => (
        <div key={`price-${h.key}`} className="check-row" style={{ alignItems: "flex-start" }}>
          <span>
            Observed price history ({platformLabel(h.marketplace)}):{" "}
            {h.observations.map((o) => `$${o.value} on ${new Date(o.clipped_at).toLocaleDateString()}`).join(" → ")}
          </span>
        </div>
      ))}
      {bsrHistory.map((h) => (
        <div key={`bsr-${h.key}`} className="check-row" style={{ alignItems: "flex-start" }}>
          <span>
            Observed BSR history ({platformLabel(h.marketplace)}, {h.direction === "down" ? "improving" : h.direction === "up" ? "declining" : "stable"}):{" "}
            {h.observations.map((o) => `#${o.value.toLocaleString()} on ${new Date(o.clipped_at).toLocaleDateString()}`).join(" → ")}
          </span>
        </div>
      ))}
    </div>
  );
}

type NoteRow = { id: string; content: string };

/** Reuses research_notes exactly as every other research path already does — see 0024's widened owner check. */
function NotesList({ scopeColumn, scopeId }: { scopeColumn: "opportunity_id" | "competition_set_id"; scopeId: string }) {
  const supabase = createClient();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [newNote, setNewNote] = useState("");

  async function load() {
    const { data } = await supabase.from("research_notes").select("id, content").eq(scopeColumn, scopeId).order("created_at", { ascending: false });
    setNotes((data as NoteRow[]) ?? []);
  }
  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId]);

  async function addNote() {
    if (!newNote.trim()) return;
    await supabase.from("research_notes").insert({ [scopeColumn]: scopeId, research_type: "user_note", content: newNote.trim(), source_type: "user_provided" });
    setNewNote("");
    await load();
  }
  async function removeNote(id: string) {
    await supabase.from("research_notes").delete().eq("id", id);
    await load();
  }

  return (
    <div style={{ marginTop: "10px" }}>
      {notes.map((n) => (
        <div className="check-row" key={n.id}>
          <span style={{ fontSize: "12px" }}>{n.content}</span>
          <button className="btn btn-secondary" style={{ padding: "2px 8px" }} onClick={() => removeNote(n.id)}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
        <input placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)} style={{ flex: 1, fontSize: "12px" }} />
        <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={addNote}>+ Add</button>
      </div>
    </div>
  );
}

function ComparisonTable({ clips }: { clips: ScoutClip[] }) {
  if (clips.length === 0) return null;
  const rows: [string, (c: ScoutClip) => string][] = [
    ["Marketplace", (c) => platformLabel(c.marketplace)],
    ["BSR", (c) => (c.bsr != null ? `#${c.bsr.toLocaleString()}` : "—")],
    ["Category rank", (c) => (c.category_rank != null ? `#${c.category_rank.toLocaleString()}` : "—")],
    ["Price", (c) => (c.price != null ? `$${c.price}` : "—")],
    ["Published", (c) => c.published_date ?? "—"],
    ["Publisher", (c) => c.publisher ?? "—"],
    ["Rating", (c) => (c.rating != null ? String(c.rating) : "—")],
    ["Reviews", (c) => (c.review_count != null ? c.review_count.toLocaleString() : "—")],
    ["Category", (c) => c.category ?? "—"],
    ["Sales", () => "Not available from captured marketplace evidence"],
    ["Captured", (c) => new Date(c.clipped_at).toLocaleDateString()],
  ];
  return (
    <div style={{ overflowX: "auto", marginTop: "10px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 8px" }}></th>
            {clips.map((c) => (
              <th key={c.id} style={{ textAlign: "left", padding: "4px 8px" }}>{c.title || c.source_url}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label}>
              <td className="hint" style={{ padding: "4px 8px", fontWeight: 700 }}>{label}</td>
              {clips.map((c) => (
                <td key={c.id} style={{ padding: "4px 8px" }}>{fn(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: "6px" }}>OBSERVED for marketplace fields, CALCULATED for anything derived — all sourced from your own clips.</p>
    </div>
  );
}

const SIGNAL_COLOR: Record<string, string> = {
  STRONG: "#3ddc9a",
  MODERATE: "#4c8bff",
  WEAK: "#ffc266",
  UNCLEAR: "#8d96ab",
  INSUFFICIENT_EVIDENCE: "#8d96ab",
};

/** Qualitative Opportunity Signals (v3) — never a single opaque "Opportunity = 87" number. */
function OpportunitySignalsDisplay({ signals }: { signals: OpportunitySignals }) {
  const [showWhy, setShowWhy] = useState<string | null>(null);
  return (
    <div className="checklist-panel" style={{ marginTop: "10px" }}>
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>Opportunity Signals</div>
      <div className="hint" style={{ marginBottom: "10px" }}>
        Sample: {signals.sample.booksAnalyzed} book(s) · {signals.sample.marketplaces.map(platformLabel).join(", ") || "no marketplace"}
        {signals.sample.earliestCapture && signals.sample.latestCapture && (
          <> · captured {new Date(signals.sample.earliestCapture).toLocaleDateString()} – {new Date(signals.sample.latestCapture).toLocaleDateString()}</>
        )}
        {" "}· Calculation v{signals.calculationVersion}
      </div>
      {signals.signals.map((s) => (
        <div key={s.label} className="check-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
            <span style={{ fontWeight: 600, fontSize: "13px" }}>{s.label}</span>
            <span style={{ color: SIGNAL_COLOR[s.status], fontWeight: 700, fontSize: "12px" }}>{s.status.replace(/_/g, " ")}</span>
          </div>
          <button className="btn btn-secondary" style={{ padding: "2px 8px" }} onClick={() => setShowWhy(showWhy === s.label ? null : s.label)}>
            {showWhy === s.label ? "Hide" : "Why?"}
          </button>
          {showWhy === s.label && (
            <div style={{ fontSize: "12px" }}>
              <div><strong>Evidence:</strong> {s.evidence}</div>
              <div><strong>Reasoning:</strong> {s.reasoning}</div>
              <div className="hint">Confidence: {s.confidence}</div>
            </div>
          )}
        </div>
      ))}
      <p className="hint" style={{ marginTop: "8px" }}>{signals.disclaimer}</p>
    </div>
  );
}

/** Evidence Completeness / Freshness / Evidence Quality (v3 spec sections 8, 33, 34) — never a market score. */
function EvidenceSummary({ clip }: { clip: ScoutClip }) {
  const [expanded, setExpanded] = useState(false);
  const completeness = computeEvidenceCompleteness(clip);
  const freshness = computeFreshness(clip.clipped_at);
  const quality = computeEvidenceQuality(clip);
  return (
    <div style={{ marginTop: "6px" }}>
      <button className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={() => setExpanded((v) => !v)}>
        Evidence: {completeness.pct}% · {quality} · {freshness}
      </button>
      {expanded && (
        <div style={{ marginTop: "6px", fontSize: "12px" }}>
          <div>Evidence Completeness: {completeness.observedCount}/{completeness.totalExpected} fields observed ({completeness.pct}%)</div>
          <div>Evidence Quality: {quality} · Freshness: {freshness} (captured {new Date(clip.clipped_at).toLocaleDateString()})</div>
          <div className="hint" style={{ marginTop: "4px" }}>
            {completeness.fields.map((f) => `${f.field}: ${f.status}`).join(" · ")}
          </div>
          <div style={{ marginTop: "6px" }}>
            <strong>Sales:</strong> Not available from captured marketplace evidence. Ranking: {clip.bsr != null ? "Observed" : "Unavailable"}. Sales: Unknown.
          </div>
        </div>
      )}
    </div>
  );
}

function MyClipsPanel({
  clips,
  sessions,
  snapshots,
  competitionSets,
  watched,
  userId,
  onChanged,
}: {
  clips: ScoutClip[];
  sessions: { id: string; topic: string }[];
  snapshots: ScoutSnapshot[];
  competitionSets: CompetitionSet[];
  watched: WatchedBook[];
  userId: string | null;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [assigning, setAssigning] = useState<string | null>(null);

  async function assign(clip: ScoutClip, sessionId: string) {
    setAssigning(clip.id);
    await supabase.from("competitor_research").insert({
      session_id: sessionId,
      title: clip.title || clip.source_url,
      author: clip.author,
      price: clip.price,
      category: clip.category,
      source_url: clip.source_url,
      platform: clip.marketplace === "google_play_books" ? "google_play" : clip.marketplace,
      source_type: "browser_clip",
      confidence: "high",
    });
    await supabase.from("scout_clips").update({ status: "assigned", assigned_session_id: sessionId }).eq("id", clip.id);
    setAssigning(null);
    onChanged();
  }

  async function discard(clipId: string) {
    await supabase.from("scout_clips").update({ status: "discarded" }).eq("id", clipId);
    onChanged();
  }

  async function addToSet(clipId: string, setId: string) {
    await supabase.from("competition_set_clips").insert({ competition_set_id: setId, clip_id: clipId });
    onChanged();
  }

  function watchKeyFor(clip: ScoutClip): { isbn: string; marketplace?: undefined; external_id?: undefined } | { isbn?: undefined; marketplace: string; external_id: string } | null {
    if (clip.isbn) return { isbn: clip.isbn };
    if (clip.external_id) return { marketplace: clip.marketplace, external_id: clip.external_id };
    return null;
  }
  function findWatch(clip: ScoutClip): WatchedBook | undefined {
    const key = watchKeyFor(clip);
    if (!key) return undefined;
    return watched.find((w) => (key.isbn ? w.isbn === key.isbn : w.marketplace === key.marketplace && w.external_id === key.external_id));
  }
  async function toggleWatch(clip: ScoutClip) {
    const key = watchKeyFor(clip);
    if (!key || !userId) return;
    const existing = findWatch(clip);
    if (existing) await supabase.from("watched_books").delete().eq("id", existing.id);
    else await supabase.from("watched_books").insert({ user_id: userId, title: clip.title, author: clip.author, ...key });
    onChanged();
  }

  const unassigned = clips.filter((c) => c.status === "unassigned");
  const snapshotLabel = (id: string | null) => (id ? snapshots.find((s) => s.id === id)?.label ?? "Untitled snapshot" : null);
  const grouped = new Map<string, ScoutClip[]>();
  for (const clip of unassigned) {
    const key = clip.snapshot_id ?? "__none__";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(clip);
  }

  return (
    <div className="panel">
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>My Clips ({unassigned.length})</div>
      <p className="hint" style={{ marginBottom: "12px" }}>
        Captured with InkframeScout, one deliberate click at a time — file each into a research session as real
        competitor evidence, save it to a Competition Set, watch it, or discard it.
      </p>
      {clips.length === 0 ? (
        <p className="hint">No evidence captured yet. Browse a supported marketplace page with InkframeScout and click &quot;Capture Evidence&quot; to begin building market history.</p>
      ) : (
        <CrossPlatformInsights clips={clips} />
      )}
      {Array.from(grouped.entries()).map(([key, groupClips]) => (
        <div key={key} style={{ marginBottom: "14px" }}>
          {key !== "__none__" && <div className="hint" style={{ fontWeight: 700, marginBottom: "6px" }}>📸 {snapshotLabel(key)}</div>}
          {groupClips.map((clip) => (
            <div key={clip.id} className="checklist-panel" style={{ marginBottom: "10px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px" }}>{clip.title || clip.source_url}</div>
              <div className="hint" style={{ fontSize: "12px", marginBottom: "8px" }}>
                {platformLabel(clip.marketplace)}
                {clip.author ? ` · ${clip.author}` : ""}
                {clip.price != null ? ` · $${clip.price}` : ""}
                {clip.bsr != null ? ` · BSR #${clip.bsr.toLocaleString()}` : ""} · {new Date(clip.clipped_at).toLocaleString()}
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <select onChange={(e) => e.target.value && assign(clip, e.target.value)} disabled={assigning === clip.id} defaultValue="">
                  <option value="" disabled>Assign to session…</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>{s.topic || "Open discovery"}</option>
                  ))}
                </select>
                {competitionSets.length > 0 && (
                  <select onChange={(e) => e.target.value && addToSet(clip.id, e.target.value)} defaultValue="">
                    <option value="" disabled>+ Add to set…</option>
                    {competitionSets.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                )}
                <button className="btn btn-secondary" onClick={() => toggleWatch(clip)} disabled={!watchKeyFor(clip)}>
                  {findWatch(clip) ? "★ Watching" : "☆ Watch"}
                </button>
                <button className="btn btn-secondary" onClick={() => discard(clip.id)}>Discard</button>
              </div>
              <EvidenceSummary clip={clip} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CompetitionSetsPanel({
  sets,
  memberships,
  clips,
  userId,
  onChanged,
}: {
  sets: CompetitionSet[];
  memberships: CompetitionSetClipRow[];
  clips: ScoutClip[];
  userId: string | null;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [newLabel, setNewLabel] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comparing, setComparing] = useState<Set<string>>(new Set());
  const [signals, setSignals] = useState<Record<string, OpportunitySignals>>({});
  const [showSignalsFor, setShowSignalsFor] = useState<string | null>(null);
  const [creatingOpportunity, setCreatingOpportunity] = useState<string | null>(null);

  async function createSet() {
    if (!newLabel.trim() || !userId) return;
    await supabase.from("competition_sets").insert({ user_id: userId, label: newLabel.trim() });
    setNewLabel("");
    onChanged();
  }
  async function deleteSet(id: string) {
    await supabase.from("competition_sets").delete().eq("id", id);
    onChanged();
  }
  async function removeClip(setId: string, clipId: string) {
    await supabase.from("competition_set_clips").delete().eq("competition_set_id", setId).eq("clip_id", clipId);
    onChanged();
  }

  function clipsForSet(setId: string): ScoutClip[] {
    const ids = new Set(memberships.filter((m) => m.competition_set_id === setId).map((m) => m.clip_id));
    return clips.filter((c) => ids.has(c.id));
  }

  function runSignals(setId: string) {
    setSignals((r) => ({ ...r, [setId]: computeOpportunitySignals(clipsForSet(setId)) }));
    setShowSignalsFor(setId);
  }

  async function saveOpportunity(setId: string, label: string) {
    if (!userId) return;
    setCreatingOpportunity(setId);
    const setClips = clipsForSet(setId);
    const computed = signals[setId] ?? computeOpportunitySignals(setClips);
    await supabase.from("scout_opportunities").insert({
      user_id: userId,
      title: label,
      competition_set_id: setId,
      evidence: setClips.map((c) => ({ type: "scout_clip", id: c.id })),
      score: computed,
      status: "new",
    });
    setCreatingOpportunity(null);
    onChanged();
  }

  return (
    <div className="panel">
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>Competition Sets</div>
      <p className="hint" style={{ marginBottom: "10px" }}>Group clipped books together to compare and analyze them as a market.</p>
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
        <input placeholder="New set name…" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={createSet}>+ New Set</button>
      </div>
      {sets.length === 0 && <p className="hint">Save books to create your first competition set — use &quot;+ Add to set&quot; on a clip in My Clips.</p>}
      {sets.map((set) => {
        const setClips = clipsForSet(set.id);
        const isExpanded = expanded === set.id;
        return (
          <div key={set.id} className="checklist-panel" style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setExpanded(isExpanded ? null : set.id)}>
              <span style={{ fontWeight: 600 }}>{set.label} ({setClips.length})</span>
              <span className="hint">{isExpanded ? "▲" : "▼"}</span>
            </div>
            {isExpanded && (
              <div style={{ marginTop: "10px" }}>
                {setClips.length === 0 && <p className="hint">No books in this set yet.</p>}
                {setClips.map((c) => (
                  <div className="check-row" key={c.id} style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <label style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={comparing.has(c.id)}
                          onChange={(e) => {
                            const next = new Set(comparing);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            setComparing(next);
                          }}
                        />
                        {c.title || c.source_url} <span className="hint">({platformLabel(c.marketplace)})</span>
                      </label>
                      <button className="btn btn-secondary" style={{ padding: "2px 8px" }} onClick={() => removeClip(set.id, c.id)}>Remove</button>
                    </div>
                    <EvidenceSummary clip={c} />
                  </div>
                ))}
                {comparing.size >= 2 && <ComparisonTable clips={setClips.filter((c) => comparing.has(c.id))} />}
                <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                  <button className="btn btn-secondary" onClick={() => runSignals(set.id)} disabled={setClips.length === 0}>Opportunity Signals</button>
                  <button className="btn btn-secondary" onClick={() => saveOpportunity(set.id, set.label)} disabled={creatingOpportunity === set.id || setClips.length === 0}>
                    {creatingOpportunity === set.id ? "Saving…" : "Explore Opportunity"}
                  </button>
                  <button className="btn btn-secondary" onClick={() => deleteSet(set.id)}>Delete Set</button>
                </div>
                {showSignalsFor === set.id && signals[set.id] && <OpportunitySignalsDisplay signals={signals[set.id]} />}
                <NotesList scopeColumn="competition_set_id" scopeId={set.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WatchlistPanel({ watched, clips, onChanged }: { watched: WatchedBook[]; clips: ScoutClip[]; onChanged: () => void }) {
  const supabase = createClient();

  async function unwatch(id: string) {
    await supabase.from("watched_books").delete().eq("id", id);
    onChanged();
  }

  function matchingClips(w: WatchedBook): ScoutClip[] {
    return clips.filter((c) => (w.isbn ? c.isbn === w.isbn : c.marketplace === w.marketplace && c.external_id === w.external_id));
  }

  return (
    <div className="panel">
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>Watchlist</div>
      <p className="hint" style={{ marginBottom: "10px" }}>
        Books you&apos;re tracking. Updates only arrive when you clip a watched book again — nothing is checked automatically in the background.
      </p>
      {watched.length === 0 && <p className="hint">No watched books yet — use &quot;☆ Watch&quot; on a clip in My Clips.</p>}
      {watched.map((w) => {
        const matches = matchingClips(w);
        const latest = matches.slice().sort((a, b) => new Date(b.clipped_at).getTime() - new Date(a.clipped_at).getTime())[0];
        const bsrSeries = buildObservedSeries(matches, "bsr");
        const priceSeries = buildObservedSeries(matches, "price");
        return (
          <div key={w.id} className="checklist-panel" style={{ marginBottom: "10px" }}>
            <div style={{ fontWeight: 600, fontSize: "13px" }}>{w.title || "Untitled"}{w.author ? ` — ${w.author}` : ""}</div>
            <div className="hint" style={{ fontSize: "12px", marginBottom: "8px" }}>
              {matches.length} observation(s) recorded
              {latest?.price != null ? ` · latest price $${latest.price}` : ""}
              {latest?.bsr != null ? ` · latest BSR #${latest.bsr.toLocaleString()}` : ""}
              {latest ? ` · last seen ${new Date(latest.clipped_at).toLocaleDateString()}` : ""}
            </div>
            {matches.length < 2 && <p className="hint">Not enough observations yet — clip this book again later to start a trend.</p>}
            {bsrSeries.length > 0 && (
              <div className="hint" style={{ fontSize: "12px" }}>
                BSR trend: {bsrSeries[0].direction === "down" ? "improving" : bsrSeries[0].direction === "up" ? "declining" : "stable"}
              </div>
            )}
            {priceSeries.length > 0 && (
              <div className="hint" style={{ fontSize: "12px" }}>
                Price trend: {priceSeries[0].direction === "up" ? "increasing" : priceSeries[0].direction === "down" ? "decreasing" : "stable"}
              </div>
            )}
            <button className="btn btn-secondary" style={{ marginTop: "8px" }} onClick={() => unwatch(w.id)}>Unwatch</button>
          </div>
        );
      })}
    </div>
  );
}

function MarketScannerPanel({
  snapshots,
  competitionSets,
  clips,
  memberships,
  userId,
  onChanged,
}: {
  snapshots: ScoutSnapshot[];
  competitionSets: CompetitionSet[];
  clips: ScoutClip[];
  memberships: CompetitionSetClipRow[];
  userId: string | null;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [source, setSource] = useState<string>("");
  const [result, setResult] = useState<MarketScanResult | null>(null);
  const [creating, setCreating] = useState(false);

  function clipsForSource(): ScoutClip[] {
    if (!source) return [];
    const [kind, id] = [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)];
    if (kind === "snapshot") return clips.filter((c) => c.snapshot_id === id);
    if (kind === "set") {
      const ids = new Set(memberships.filter((m) => m.competition_set_id === id).map((m) => m.clip_id));
      return clips.filter((c) => ids.has(c.id));
    }
    return [];
  }

  function run() {
    setResult(scanMarket(clipsForSource()));
  }

  async function createOpportunity() {
    if (!userId || !result) return;
    setCreating(true);
    const label =
      source.startsWith("snapshot:")
        ? snapshots.find((s) => s.id === source.slice("snapshot:".length))?.label
        : competitionSets.find((s) => s.id === source.slice("set:".length))?.label;
    await supabase.from("scout_opportunities").insert({
      user_id: userId,
      title: label || "Market opportunity",
      market: label || null,
      evidence: clipsForSource().map((c) => ({ type: "scout_clip", id: c.id })),
      status: "new",
    });
    setCreating(false);
    onChanged();
  }

  const sourceOptions = [
    ...snapshots.map((s) => ({ value: `snapshot:${s.id}`, label: `📸 ${s.label}` })),
    ...competitionSets.map((s) => ({ value: `set:${s.id}`, label: `📁 ${s.label}` })),
  ];

  return (
    <div className="panel">
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>Market Scanner</div>
      <p className="hint" style={{ marginBottom: "10px" }}>
        Analyzes books you&apos;ve already clipped into a snapshot or competition set — never a live scan of a marketplace page.
      </p>
      {sourceOptions.length === 0 ? (
        <p className="hint">Clip a few books into a snapshot or competition set to run the Market Scanner.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Choose a snapshot or competition set…</option>
              {sourceOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={run} disabled={!source}>Scan</button>
          </div>
          {result && (
            <div className="checklist-panel">
              <div>Books analyzed: {result.booksAnalyzed}</div>
              <div>Observed categories: {result.observedCategories}</div>
              {result.priceRange && <div>Price range: ${result.priceRange.min} – ${result.priceRange.max} (avg ${result.priceRange.avg})</div>}
              {result.topClusters.length > 0 ? (
                <div style={{ marginTop: "8px" }}>
                  <div className="hint" style={{ fontWeight: 700 }}>Top clusters</div>
                  {result.topClusters.map((c) => (
                    <div key={c.label} className="hint">{c.label} ({c.matchingBooks} book(s))</div>
                  ))}
                </div>
              ) : (
                <p className="hint">Not enough title data yet to identify clusters.</p>
              )}
              <button className="btn btn-secondary" style={{ marginTop: "10px" }} onClick={createOpportunity} disabled={creating}>
                {creating ? "Saving…" : "Create Opportunity from this Market"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const OPPORTUNITY_STATUSES = ["new", "reviewing", "researching", "approved", "rejected"] as const;

function OpportunityWorkspacePanel({
  opportunities,
  clips,
  memberships,
  onChanged,
  onOpenSession,
}: {
  opportunities: ScoutOpportunity[];
  clips: ScoutClip[];
  memberships: CompetitionSetClipRow[];
  onChanged: () => void;
  onOpenSession: (id: string) => void;
}) {
  const supabase = createClient();
  const [starting, setStarting] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  function clipsForOpportunity(o: ScoutOpportunity): ScoutClip[] {
    if (!o.competition_set_id) return [];
    const ids = new Set(memberships.filter((m) => m.competition_set_id === o.competition_set_id).map((m) => m.clip_id));
    return clips.filter((c) => ids.has(c.id));
  }

  async function setStatus(o: ScoutOpportunity, status: string) {
    await supabase.from("scout_opportunities").update({ status }).eq("id", o.id);
    onChanged();
  }

  async function startResearch(o: ScoutOpportunity) {
    setStarting(o.id);
    const { data: session, error } = await supabase
      .from("research_sessions")
      .insert({ topic: o.title, mode: "book_opportunity", platforms: ["amazon", "google_play", "kobo", "web"], status: "queued", stages: [] })
      .select("id")
      .single();
    if (!error && session) {
      for (const c of clipsForOpportunity(o)) {
        await supabase.from("competitor_research").insert({
          session_id: session.id,
          title: c.title || c.source_url,
          author: c.author,
          price: c.price,
          category: c.category,
          source_url: c.source_url,
          platform: c.marketplace === "google_play_books" ? "google_play" : c.marketplace,
          source_type: "browser_clip",
          confidence: "high",
        });
      }
      await supabase.from("scout_opportunities").update({ session_id: session.id, status: "researching" }).eq("id", o.id);
    }
    setStarting(null);
    onChanged();
  }

  async function analyze(o: ScoutOpportunity) {
    const setClips = clipsForOpportunity(o).filter((c) => c.title);
    if (setClips.length === 0) return;
    setAnalyzing(o.id);
    try {
      const res = await fetch("/api/inkframescout/differentiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_ids: setClips.map((c) => c.id), opportunity_id: o.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
    } catch {
      // Surfaced by the opportunity's fields staying empty — the user can retry from here.
    }
    setAnalyzing(null);
    onChanged();
  }

  return (
    <div className="panel">
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>Opportunity Workspace</div>
      <p className="hint" style={{ marginBottom: "10px" }}>
        Only an opportunity you explicitly approve, then explicitly turn into research, can ever become a Book Project.
      </p>
      {opportunities.length === 0 && <p className="hint">Scan a market or save a competition set to begin opportunity analysis.</p>}
      {opportunities.map((o) => (
        <div key={o.id} className="checklist-panel" style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{o.title}</span>
            {o.status === "converted_to_project" ? (
              <span className="ok">converted to project</span>
            ) : (
              <select value={o.status} onChange={(e) => setStatus(o, e.target.value)}>
                {OPPORTUNITY_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
          </div>
          {o.market && <div className="hint" style={{ fontSize: "12px" }}>Market: {o.market}</div>}
          {o.score && (
            <div className="hint" style={{ fontSize: "12px", marginTop: "6px" }}>
              {o.score.signals.map((s) => `${s.label}: ${s.status.replace(/_/g, " ")}`).join(" · ")}
            </div>
          )}
          {o.potential_audience && (
            <div style={{ fontSize: "12px", marginTop: "8px" }}>
              <strong>Potential audience (RECOMMENDED):</strong> {o.potential_audience}
            </div>
          )}
          {o.potential_differentiation && (
            <div style={{ fontSize: "12px", marginTop: "4px" }}>
              <strong>Differentiation directions (RECOMMENDED):</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>{o.potential_differentiation}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
            <button className="btn btn-secondary" onClick={() => analyze(o)} disabled={analyzing === o.id || !o.competition_set_id}>
              {analyzing === o.id ? "Analyzing…" : "Differentiation Analysis"}
            </button>
            {!o.session_id ? (
              <button className="btn btn-secondary" onClick={() => startResearch(o)} disabled={starting === o.id}>
                {starting === o.id ? "Starting…" : "Start Research"}
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={() => onOpenSession(o.session_id!)}>Open Research Session →</button>
            )}
          </div>
          <NotesList scopeColumn="opportunity_id" scopeId={o.id} />
        </div>
      ))}
    </div>
  );
}

function InkframeScoutWorkspace({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [clips, setClips] = useState<ScoutClip[]>([]);
  const [sessions, setSessions] = useState<{ id: string; topic: string }[]>([]);
  const [snapshots, setSnapshots] = useState<ScoutSnapshot[]>([]);
  const [competitionSets, setCompetitionSets] = useState<CompetitionSet[]>([]);
  const [memberships, setMemberships] = useState<CompetitionSetClipRow[]>([]);
  const [watched, setWatched] = useState<WatchedBook[]>([]);
  const [opportunities, setOpportunities] = useState<ScoutOpportunity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  async function loadAll() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);
    const [{ data: c }, { data: s }, { data: snaps }, { data: sets }, { data: mem }, { data: w }, { data: opps }] = await Promise.all([
      supabase
        .from("scout_clips")
        .select("id, marketplace, title, author, publisher, source_url, external_id, isbn, price, bsr, category, category_rank, rating, review_count, published_date, clipped_at, status, snapshot_id")
        .neq("status", "discarded")
        .order("clipped_at", { ascending: false })
        .limit(300),
      supabase.from("research_sessions").select("id, topic").order("created_at", { ascending: false }).limit(30),
      supabase.from("scout_snapshots").select("id, label").order("created_at", { ascending: false }).limit(50),
      supabase.from("competition_sets").select("id, label").order("created_at", { ascending: false }).limit(50),
      supabase.from("competition_set_clips").select("competition_set_id, clip_id"),
      supabase.from("watched_books").select("id, isbn, marketplace, external_id, title, author").order("created_at", { ascending: false }),
      supabase
        .from("scout_opportunities")
        .select("id, title, market, competition_set_id, session_id, project_id, score, potential_audience, potential_positioning, potential_differentiation, risks, status")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setClips((c as ScoutClip[]) ?? []);
    setSessions(s ?? []);
    setSnapshots((snaps as ScoutSnapshot[]) ?? []);
    setCompetitionSets((sets as CompetitionSet[]) ?? []);
    setMemberships((mem as CompetitionSetClipRow[]) ?? []);
    setWatched((w as WatchedBook[]) ?? []);
    setOpportunities((opps as ScoutOpportunity[]) ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    (async () => {
      await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  if (!loaded) return null;
  // Nothing InkframeScout-related exists yet for this user — stay out of the way rather than
  // showing five empty panels to someone who's never installed the extension.
  if (clips.length === 0 && competitionSets.length === 0 && watched.length === 0 && opportunities.length === 0) return null;

  return (
    <>
      <MyClipsPanel clips={clips} sessions={sessions} snapshots={snapshots} competitionSets={competitionSets} watched={watched} userId={userId} onChanged={refresh} />
      <CompetitionSetsPanel sets={competitionSets} memberships={memberships} clips={clips} userId={userId} onChanged={refresh} />
      <WatchlistPanel watched={watched} clips={clips} onChanged={refresh} />
      <MarketScannerPanel snapshots={snapshots} competitionSets={competitionSets} clips={clips} memberships={memberships} userId={userId} onChanged={refresh} />
      <OpportunityWorkspacePanel opportunities={opportunities} clips={clips} memberships={memberships} onChanged={refresh} onOpenSession={onOpenSession} />
    </>
  );
}

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

function ResearchPageInner() {
  const router = useRouter();
  // Deep link from the Suggestion Bar's "Open in Research" (?session=<id>) — opens
  // straight into that session instead of leaving the user to find it in the list.
  // Read directly as the initial state (same pattern as job-progress's ?project=),
  // not copied via a useEffect, so there's no extra render or setState-in-effect.
  const searchParams = useSearchParams();
  const initialSession = searchParams.get("session");
  const [view, setView] = useState<"overview" | "new" | "session">(initialSession ? "session" : "overview");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSession);
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
            <InkframeScoutWorkspace
              onOpenSession={(id) => {
                setActiveSessionId(id);
                setView("session");
              }}
            />
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

export default function ResearchPage() {
  return (
    <Suspense fallback={null}>
      <ResearchPageInner />
    </Suspense>
  );
}

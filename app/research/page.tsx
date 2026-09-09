"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";
import type { ResearchReport } from "@/lib/research-report";

export const dynamic = "force-dynamic";

type ResearchNote = { id: string; research_type: string; content: string };
type TitleRisk = { status: string; notes: string | null; title_checked: string | null };

type Competitor = {
  id: string;
  title: string;
  author: string | null;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  recurring_complaints: string | null;
  recurring_praise: string | null;
  content_gap: string | null;
  source_url: string | null;
  source_type: string;
};
type Keyword = { id: string; keyword: string; demand_signal: string | null; competition_signal: string | null; source_url: string | null; source_type: string };
type Category = { id: string; category_name: string; rationale: string | null; source_url: string | null; source_type: string };
type SavedReport = {
  id: string;
  sections: ResearchReport["sections"];
  overall_assessment: string;
  confidence_level: string;
  evidence_summary: string;
  status: string;
  created_at: string;
};

const ASSESSMENT_LABEL: Record<string, string> = {
  very_promising: "Very Promising",
  promising: "Promising",
  moderate: "Moderate",
  high_competition: "High Competition",
  difficult: "Difficult",
  insufficient_data: "Insufficient Data",
};

const SECTION_LABEL: Record<keyof ResearchReport["sections"], string> = {
  market_overview: "Market Overview",
  niche_assessment: "Niche Assessment",
  audience: "Audience",
  competitor_landscape: "Competitor Landscape",
  review_insights: "Review Insights",
  market_gaps: "Market Gaps",
  keyword_opportunities: "Keyword Opportunities",
  category_opportunities: "Category Opportunities",
  pricing_positioning: "Pricing / Positioning",
  risks: "Risks",
  opportunities: "Opportunities",
  recommended_angle: "Recommended Angle",
  differentiation_strategy: "Differentiation Strategy",
  final_recommendation: "Final Recommendation",
};

export default function ResearchPage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);

  const [notes, setNotes] = useState<ResearchNote[] | null>(null);
  const [titleRisk, setTitleRisk] = useState<TitleRisk | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reports, setReports] = useState<SavedReport[]>([]);

  const [newCompetitor, setNewCompetitor] = useState({ title: "", author: "", price: "", rating: "", review_count: "", recurring_complaints: "", recurring_praise: "", content_gap: "", source_url: "" });
  const [newKeyword, setNewKeyword] = useState({ keyword: "", demand_signal: "", competition_signal: "", source_url: "" });
  const [newCategory, setNewCategory] = useState({ category_name: "", rationale: "", source_url: "" });

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    if (!effectiveId) return;
    const [{ data: noteRows }, { data: riskRows }, { data: compRows }, { data: kwRows }, { data: catRows }, { data: reportRows }] = await Promise.all([
      supabase.from("research_notes").select("id, research_type, content").eq("project_id", effectiveId),
      supabase.from("title_risk_checks").select("status, notes, title_checked").eq("project_id", effectiveId).order("checked_at", { ascending: false }).limit(1),
      supabase.from("competitor_research").select("*").eq("project_id", effectiveId).order("checked_at", { ascending: false }),
      supabase.from("keyword_research").select("*").eq("project_id", effectiveId).order("checked_at", { ascending: false }),
      supabase.from("category_research").select("*").eq("project_id", effectiveId).order("checked_at", { ascending: false }),
      supabase.from("research_reports").select("*").eq("project_id", effectiveId).order("created_at", { ascending: false }),
    ]);
    setNotes(noteRows ?? []);
    setTitleRisk(riskRows?.[0] ?? null);
    setCompetitors(compRows ?? []);
    setKeywords(kwRows ?? []);
    setCategories(catRows ?? []);
    setReports(reportRows ?? []);
  }

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setNotes(null);
      setTitleRisk(null);
      if (!cancelled) await loadAll();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId]);

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveId || !newCompetitor.title.trim()) return;
    const { error } = await supabase.from("competitor_research").insert({
      project_id: effectiveId,
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
    if (!effectiveId || !newKeyword.keyword.trim()) return;
    const { error } = await supabase.from("keyword_research").insert({
      project_id: effectiveId,
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
    if (!effectiveId || !newCategory.category_name.trim()) return;
    const { error } = await supabase.from("category_research").insert({
      project_id: effectiveId,
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

  async function handleGenerateReport() {
    if (!effectiveId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/research/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: effectiveId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Report generation failed.");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function setReportStatus(id: string, status: string) {
    await supabase.from("research_reports").update({ status }).eq("id", id);
    await loadAll();
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
        <h1>🔎 Research</h1>
        <p className="subtitle">
          An evidence workspace, not a guess generator. Enter what you&apos;ve actually found researching competing
          books yourself — InkFrame never claims to have checked Amazon or the web unless it actually did.
        </p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && (
          <>
            <div className="safety-note">
              InkFrame cannot automatically browse Amazon or most of the web today — Amazon&apos;s own terms
              prohibit automated scraping, and no live search provider is configured in this deployment. Rows you
              add below are tagged &quot;user provided&quot;; AI-only analysis is tagged &quot;ai inference&quot; and is never
              presented as a live check.
            </div>

            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "8px" }}>Title Check</div>
              {titleRisk === null && notes === null && <p className="hint">Loading…</p>}
              {titleRisk === null && notes !== null && (
                <p className="hint">No title check has run yet — this happens automatically in the New Book wizard.</p>
              )}
              {titleRisk && (
                <>
                  <p style={{ fontSize: "13px" }}>{titleRisk.status.replace(/_/g, " ")}</p>
                  <p className="hint" style={{ marginTop: "6px" }}>{titleRisk.notes}</p>
                </>
              )}
            </div>

            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "8px" }}>Category Research (AI Inference)</div>
              {notes && notes.filter((n) => n.research_type === "genre").length === 0 && <p className="hint">No category research yet.</p>}
              {notes
                ?.filter((n) => n.research_type === "genre")
                .map((n) => (
                  <p key={n.id} style={{ fontSize: "13px", color: "var(--muted)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                    {n.content}
                  </p>
                ))}
            </div>

            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "14px" }}>Competitors ({competitors.length})</div>
              <div style={{ overflowX: "auto", marginBottom: "16px" }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Author</th>
                      <th>Price</th>
                      <th>Rating</th>
                      <th>Complaints / Praise</th>
                      <th>Source</th>
                      <th />
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
                        <td>
                          <span className={`badge ${c.source_type === "user_provided" ? "active" : "user"}`}>{c.source_type.replace("_", " ")}</span>
                        </td>
                        <td>
                          <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => removeRow("competitor_research", c.id)}>
                            ✕
                          </button>
                        </td>
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
                <button className="btn btn-secondary" type="submit" style={{ gridColumn: "1 / -1" }}>
                  + Add Competitor
                </button>
              </form>
            </div>

            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "14px" }}>Keywords ({keywords.length})</div>
              <div style={{ overflowX: "auto", marginBottom: "16px" }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th>Demand</th>
                      <th>Competition</th>
                      <th>Source</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {keywords.map((k) => (
                      <tr key={k.id}>
                        <td>{k.keyword}</td>
                        <td>{k.demand_signal || "DATA NOT AVAILABLE"}</td>
                        <td>{k.competition_signal || "DATA NOT AVAILABLE"}</td>
                        <td>
                          <span className={`badge ${k.source_type === "user_provided" ? "active" : "user"}`}>{k.source_type.replace("_", " ")}</span>
                        </td>
                        <td>
                          <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => removeRow("keyword_research", k.id)}>
                            ✕
                          </button>
                        </td>
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
                <button className="btn btn-secondary" type="submit" style={{ gridColumn: "1 / -1" }}>
                  + Add Keyword
                </button>
              </form>
            </div>

            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "14px" }}>Categories ({categories.length})</div>
              <div style={{ overflowX: "auto", marginBottom: "16px" }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Rationale</th>
                      <th>Source</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c) => (
                      <tr key={c.id}>
                        <td>{c.category_name}</td>
                        <td style={{ fontSize: "12px" }}>{c.rationale || "—"}</td>
                        <td>
                          <span className={`badge ${c.source_type === "user_provided" ? "active" : "user"}`}>{c.source_type.replace("_", " ")}</span>
                        </td>
                        <td>
                          <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => removeRow("category_research", c.id)}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form onSubmit={addCategory} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <input placeholder="Category name *" value={newCategory.category_name} onChange={(e) => setNewCategory({ ...newCategory, category_name: e.target.value })} />
                <input placeholder="Source URL" value={newCategory.source_url} onChange={(e) => setNewCategory({ ...newCategory, source_url: e.target.value })} />
                <input placeholder="Why it fits / competition notes" value={newCategory.rationale} onChange={(e) => setNewCategory({ ...newCategory, rationale: e.target.value })} style={{ gridColumn: "1 / -1" }} />
                <button className="btn btn-secondary" type="submit" style={{ gridColumn: "1 / -1" }}>
                  + Add Category
                </button>
              </form>
            </div>

            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>Research Report</div>
              <p className="hint" style={{ marginBottom: "14px" }}>
                Synthesizes only the rows above (plus a live web check if one is configured) — never invents
                competitors or numbers. Generating another report never overwrites a previous one.
              </p>
              <button className="btn btn-primary" onClick={handleGenerateReport} disabled={generating}>
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
                <div className="check-row">
                  <span>Confidence</span>
                  <span>{r.confidence_level.replace(/_/g, " ")}</span>
                </div>
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
                    <button className="btn btn-primary" onClick={() => setReportStatus(r.id, "accepted")}>
                      Accept Recommendation
                    </button>
                    <button className="btn btn-secondary" onClick={() => setReportStatus(r.id, "needs_more_research")}>
                      Research More
                    </button>
                    <button className="btn btn-secondary" onClick={() => setReportStatus(r.id, "rejected")}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

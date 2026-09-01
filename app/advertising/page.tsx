"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/advertising";
import { sumMetrics, formatSpend, formatAcos, formatRoas, type MetricTotals } from "@/lib/advertising-metrics";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  project_identity: { working_title: string | null } | null;
  advertising_projects: { id: string; status: string }[] | null;
};

type Keyword = { keyword: string; group: string; rationale: string };
type Campaign = { id: string; campaign_name: string | null; objective: string | null; bid_strategy_recommendation: string | null };

export default function AdvertisingPage() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [totals, setTotals] = useState<MetricTotals>({ impressions: null, clicks: null, spend: null, orders: null, sales: null });
  const [activeCampaignCount, setActiveCampaignCount] = useState(0);
  const [myCampaigns, setMyCampaigns] = useState<Campaign[]>([]);

  const [showPicker, setShowPicker] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [result, setResult] = useState<{ campaign: Campaign; keywords: Keyword[] } | null>(null);

  const [importCampaignId, setImportCampaignId] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);

  useEffect(() => {
    document.title = pageTitle;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: projectRows } = await supabase
        .from("projects")
        .select("id, project_identity(working_title), advertising_projects(id, status)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      const rows = (projectRows as unknown as ProjectRow[]) ?? [];
      setProjects(rows);

      const adProjectIds = rows.flatMap((p) => p.advertising_projects ?? []).map((ap) => ap.id);
      if (adProjectIds.length === 0) {
        setTotals({ impressions: null, clicks: null, spend: null, orders: null, sales: null });
        setActiveCampaignCount(0);
        setMyCampaigns([]);
        return;
      }

      const { data: campaigns } = await supabase
        .from("advertising_campaigns")
        .select("id, campaign_name, objective, bid_strategy_recommendation, status")
        .in("advertising_project_id", adProjectIds);
      if (cancelled) return;

      setMyCampaigns(campaigns ?? []);
      setActiveCampaignCount((campaigns ?? []).filter((c) => c.status === "user_marked_live").length);

      const campaignIds = (campaigns ?? []).map((c) => c.id);
      if (campaignIds.length === 0) {
        setTotals({ impressions: null, clicks: null, spend: null, orders: null, sales: null });
        return;
      }
      const { data: metrics } = await supabase
        .from("advertising_metrics")
        .select("impressions, clicks, spend, orders, sales")
        .in("campaign_id", campaignIds);
      if (!cancelled) setTotals(sumMetrics(metrics ?? []));
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadTick, supabase]);

  async function handleAdvertiseProject(projectId: string) {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/advertising/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not draft a strategy.");
      setResult({ campaign: json.campaign, keywords: json.keywords });
      setShowPicker(false);
      reload();
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Could not draft a strategy.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleImportFile(file: File) {
    if (!importCampaignId) {
      setImportMessage("Pick a campaign first.");
      return;
    }
    setImporting(true);
    setImportMessage(null);
    try {
      const text = await file.text();
      const [headerLine, ...lines] = text.trim().split(/\r?\n/);
      const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());
      const required = ["date_range_start", "date_range_end"];
      if (!required.every((r) => headers.includes(r))) {
        throw new Error("CSV must have at least date_range_start and date_range_end columns.");
      }

      const rows = lines
        .filter((l) => l.trim().length > 0)
        .map((line) => {
          const cells = line.split(",").map((c) => c.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
          const num = (v: string) => (v === "" || v === undefined ? null : Number(v));
          return {
            campaign_id: importCampaignId,
            date_range_start: row.date_range_start,
            date_range_end: row.date_range_end,
            impressions: num(row.impressions),
            clicks: num(row.clicks),
            spend: num(row.spend),
            orders: num(row.orders),
            sales: num(row.sales),
            source: "csv_import" as const,
          };
        });

      const { error } = await supabase.from("advertising_metrics").insert(rows);
      if (error) throw new Error(error.message);

      setImportMessage(`Imported ${rows.length} row(s).`);
      reload();
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const hasAnyAdData = (projects ?? []).some((p) => (p.advertising_projects ?? []).length > 0);
  const eligibleProjects = (projects ?? []).filter((p) => (p.advertising_projects ?? []).length === 0);

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
        <h1>📈 Advertising</h1>
        <p className="subtitle">
          Plan, prepare, and analyze your Amazon Ads campaigns — InkFrame never spends your money or touches your
          ad account directly.
        </p>

        <div className="tabs">
          <div className="tab active">Overview</div>
          <div className="tab">🔎 Keyword Research</div>
          <div className="tab">📋 Campaign Builder</div>
          <div className="tab">📊 Analytics</div>
          <div className="tab">⚙️ Optimization</div>
          <div className="tab">🧪 Testing Lab</div>
        </div>

        <div className="stat-grid">
          <div className="stat-box">
            <div className="lbl">Total Ad Spend</div>
            <div className="val">{formatSpend(totals)}</div>
          </div>
          <div className="stat-box">
            <div className="lbl">ACOS</div>
            <div className="val">{formatAcos(totals)}</div>
          </div>
          <div className="stat-box">
            <div className="lbl">ROAS</div>
            <div className="val">{formatRoas(totals)}</div>
          </div>
          <div className="stat-box">
            <div className="lbl">Active Campaigns</div>
            <div className="val">{activeCampaignCount}</div>
          </div>
        </div>

        {!hasAnyAdData && !result && (
          <div className="empty-panel">
            <div className="ei">📭</div>
            <h3>No advertising data available yet</h3>
            <p>Connect a completed book to start building a campaign strategy, or import real performance data if you&apos;re already running ads.</p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => setShowPicker(true)}>
                Advertise a Book
              </button>
              <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={myCampaigns.length === 0}>
                Import Ad Data
              </button>
            </div>
          </div>
        )}

        {hasAnyAdData && (
          <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={() => setShowPicker(true)} disabled={eligibleProjects.length === 0}>
              Advertise Another Book
            </button>
            <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={myCampaigns.length === 0}>
              Import Ad Data
            </button>
            {myCampaigns.length > 0 && (
              <select
                value={importCampaignId}
                onChange={(e) => setImportCampaignId(e.target.value)}
                style={{ background: "var(--panel2)", color: "var(--ink)", border: "1px solid var(--border)", borderRadius: "9px", padding: "0 10px", fontSize: "13px" }}
              >
                <option value="">Import into campaign…</option>
                {myCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.campaign_name || c.id}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
        />
        {importing && <p className="hint">Importing…</p>}
        {importMessage && <p className="hint">{importMessage}</p>}

        {showPicker && (
          <div className="empty-panel" style={{ textAlign: "left" }}>
            <div style={{ fontWeight: 700, marginBottom: "10px" }}>Which book do you want to advertise?</div>
            {eligibleProjects.length === 0 && <p className="hint">All your projects already have a draft strategy.</p>}
            {eligibleProjects.map((p) => (
              <div
                key={p.id}
                className="catalog-row"
                style={{ cursor: "pointer" }}
                onClick={() => !generating && handleAdvertiseProject(p.id)}
              >
                <span className="status-dot none"></span>
                <div>
                  <div className="bname">{p.project_identity?.working_title || "Untitled Project"}</div>
                  <div className="bstatus">{generating ? "Drafting strategy…" : "Click to draft an ad strategy"}</div>
                </div>
              </div>
            ))}
            {generateError && <p style={{ color: "var(--red)", fontSize: "13px" }}>{generateError}</p>}
          </div>
        )}

        {result && (
          <div className="empty-panel" style={{ textAlign: "left" }}>
            <div style={{ fontWeight: 700, marginBottom: "6px" }}>Draft campaign: {result.campaign.campaign_name}</div>
            <p className="hint">{result.campaign.objective}</p>
            <p className="hint">{result.campaign.bid_strategy_recommendation}</p>
            <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>Keyword research ({result.keywords.length})</div>
            {result.keywords.map((k, i) => (
              <div key={i} style={{ fontSize: "12.5px", color: "var(--muted)", marginBottom: "8px" }}>
                <strong style={{ color: "var(--ink)" }}>{k.keyword}</strong> · {k.group.replace(/_/g, " ")}
                <div style={{ fontSize: "11.5px" }}>{k.rationale}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontWeight: 700, marginBottom: "12px" }}>My Advertising Catalog</div>
        <div>
          {(projects ?? []).map((p) => {
            const ad = p.advertising_projects?.[0];
            return (
              <div className="catalog-row" key={p.id}>
                <span className={`status-dot${ad ? "" : " none"}`}></span>
                <div>
                  <div className="bname">{p.project_identity?.working_title || "Untitled Project"}</div>
                  <div className="bstatus">
                    {ad ? `${ad.status === "no_data" ? "⚪" : "🟢"} ${ad.status.replace(/_/g, " ")}` : "⚪ No advertising data"}
                  </div>
                </div>
              </div>
            );
          })}
          {projects && projects.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: "13px", textAlign: "center", padding: "20px" }}>
              No books yet.
            </div>
          )}
        </div>

        <div className="safety-note">
          ✦ InkFrame prepares strategy, keywords, and campaign plans for your review. It never logs into or
          operates your Amazon Advertising account, and it never invents spend, sales, or performance numbers —
          figures only appear here once real data is available or imported.
        </div>
      </div>
    </>
  );
}

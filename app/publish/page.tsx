"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/publish";
import { assembleBookPassport, computeBookHealth, type BookPassport } from "@/lib/book-passport";
import { runPreflight, suggestPrice, ALL_FORMATS, type FormatType, type PreflightResult } from "@/lib/kdp-preparation";

export const dynamic = "force-dynamic";

type Platform = "Amazon KDP" | "Kobo" | "Google Play Books" | "Apple Books";
const FORMAT_LABELS: Record<FormatType, string> = { ebook: "Kindle eBook", paperback: "Paperback", hardcover: "Hardcover" };

type RightsBasis = "original" | "public_domain" | "licensed" | "other";
const RIGHTS_BASIS_LABELS: Record<RightsBasis, string> = {
  original: "Original work I wrote/created",
  public_domain: "Public domain content",
  licensed: "Licensed content I hold the rights to use",
  other: "Other (describe below)",
};
type Declarations = { rightsBasis: RightsBasis | ""; rightsNote: string; rightsConfirmed: boolean; aiDisclosureAcknowledged: boolean };
const EMPTY_DECLARATIONS: Declarations = { rightsBasis: "", rightsNote: "", rightsConfirmed: false, aiDisclosureAcknowledged: false };

const PLATFORM_LINKS: Record<Platform, string> = {
  "Amazon KDP": "https://kdp.amazon.com/bookshelf",
  Kobo: "https://www.kobo.com/writinglife",
  "Google Play Books": "https://play.google.com/books/publish",
  "Apple Books": "https://authors.apple.com",
};

const PLATFORM_ICONS: Record<Platform, string> = {
  "Amazon KDP": "📘",
  Kobo: "📗",
  "Google Play Books": "📙",
  "Apple Books": "📕",
};

type JobStage = { key: string; label: string; status: "pending" | "passed" | "blocked" | "failed"; detail: string };
type JobBlocker = { label: string; route: string };
type PreparedFields = { title: string; description: string; keywords: string; category: string; price: string };
type JobStatus =
  | "preparing"
  | "ready_for_review"
  | "ready_to_publish"
  | "user_marked_published"
  | "queued"
  | "running"
  | "needs_attention"
  | "failed"
  | "cancelled";
type PublishingJobRow = {
  id: string;
  status: JobStatus;
  requested_formats: FormatType[];
  stages: JobStage[];
  blockers: JobBlocker[];
  package_ref: string | null;
  prepared_fields: PreparedFields | null;
  error: string | null;
  prepared_at: string | null;
};
const ACTIVE_STATUSES: JobStatus[] = ["queued", "running"];

function CheckRow({ label, ok, text }: { label: string; ok: boolean | null; text: string }) {
  return (
    <div className="check-row">
      <span>{label}</span>
      <span className={ok ? "ok" : undefined} style={ok === false ? { color: "var(--muted)" } : ok === null ? { color: "#ffc266" } : undefined}>
        {text}
      </span>
    </div>
  );
}

function stageStatusColor(status: JobStage["status"]) {
  if (status === "passed") return "#5fe3b8";
  if (status === "failed" || status === "blocked") return "var(--red)";
  return "var(--muted)";
}
function stageStatusText(status: JobStage["status"]) {
  if (status === "passed") return "✓ done";
  if (status === "failed") return "✗ failed";
  if (status === "blocked") return "⚠ blocked";
  return "…pending";
}

function PublishBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const supabase = createClient();

  const [passport, setPassport] = useState<BookPassport | null>(null);
  const [loading, setLoading] = useState(!!projectId);
  const [approved, setApproved] = useState(false);

  const [prices, setPrices] = useState<Record<FormatType, string>>({ ebook: "", paperback: "", hardcover: "" });
  const [priceSaveState, setPriceSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const priceSkipAutosave = useRef(true);

  const [declarations, setDeclarations] = useState<Declarations>(EMPTY_DECLARATIONS);
  const [declarationsSaveState, setDeclarationsSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const declarationsSkipAutosave = useRef(true);

  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [selectedFormats, setSelectedFormats] = useState<FormatType[]>(["ebook", "paperback", "hardcover"]);
  const [job, setJob] = useState<PublishingJobRow | null>(null);
  const [startingJob, setStartingJob] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preflightMessage, setPreflightMessage] = useState<string | null>(null);
  const [downloadingPackage, setDownloadingPackage] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [markingPublished, setMarkingPublished] = useState(false);

  useEffect(() => {
    document.title = pageTitle;
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const [result, { data: editions }, { data: declarationsRow }] = await Promise.all([
        assembleBookPassport(supabase, projectId),
        supabase.from("format_editions").select("format_type, price").eq("project_id", projectId),
        supabase
          .from("publishing_declarations")
          .select("rights_basis, rights_note, rights_confirmed, ai_disclosure_acknowledged")
          .eq("project_id", projectId)
          .maybeSingle(),
      ]);
      if (cancelled || !result) return;
      setPassport(result);
      priceSkipAutosave.current = true;
      const priceByFormat: Record<FormatType, string> = { ebook: "", paperback: "", hardcover: "" };
      for (const e of editions ?? []) {
        const formatType = e.format_type as FormatType;
        if (e.price != null && (formatType === "ebook" || formatType === "paperback" || formatType === "hardcover")) {
          priceByFormat[formatType] = String(e.price);
        }
      }
      setPrices(priceByFormat);
      declarationsSkipAutosave.current = true;
      setDeclarations(
        declarationsRow
          ? {
              rightsBasis: (declarationsRow.rights_basis as RightsBasis | null) ?? "",
              rightsNote: declarationsRow.rights_note ?? "",
              rightsConfirmed: declarationsRow.rights_confirmed,
              aiDisclosureAcknowledged: declarationsRow.ai_disclosure_acknowledged,
            }
          : EMPTY_DECLARATIONS
      );
      setApproved(["USER_APPROVED", "READY_FOR_EXPORT", "EXPORTED"].includes(result.workflowStage));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Real per-format pricing, debounced-autosaved to format_editions — never
  // silently overwritten by a suggestion once the author has set a real
  // value (see suggestPrice, only ever used as a fallback display).
  useEffect(() => {
    if (!projectId) return;
    if (priceSkipAutosave.current) {
      priceSkipAutosave.current = false;
      return;
    }
    setPriceSaveState("saving");
    const timer = setTimeout(async () => {
      const writes = (Object.keys(prices) as FormatType[])
        .filter((f) => prices[f].trim() !== "" && !isNaN(Number(prices[f])))
        .map((f) => supabase.from("format_editions").upsert({ project_id: projectId, format_type: f, price: Number(prices[f]) }, { onConflict: "project_id,format_type" }));
      if (writes.length > 0) await Promise.all(writes);
      setPriceSaveState("saved");
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, projectId]);

  // Rights confirmation and AI-disclosure acknowledgment: real author
  // self-attestations InkFrame has no way to submit to a platform itself
  // (no KDP API exists — see README), so this just records that the
  // author reviewed and confirmed them. Same debounced-autosave pattern
  // as pricing above.
  useEffect(() => {
    if (!projectId) return;
    if (declarationsSkipAutosave.current) {
      declarationsSkipAutosave.current = false;
      return;
    }
    setDeclarationsSaveState("saving");
    const timer = setTimeout(async () => {
      await supabase.from("publishing_declarations").upsert(
        {
          project_id: projectId,
          rights_basis: declarations.rightsBasis || null,
          rights_note: declarations.rightsNote || null,
          rights_confirmed: declarations.rightsConfirmed,
          ai_disclosure_acknowledged: declarations.aiDisclosureAcknowledged,
        },
        { onConflict: "project_id" }
      );
      setDeclarationsSaveState("saved");
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declarations, projectId]);

  async function fetchJob(platform: Platform): Promise<PublishingJobRow | null> {
    if (!projectId) return null;
    const { data } = await supabase
      .from("publishing_jobs")
      .select("id, status, requested_formats, stages, blockers, package_ref, prepared_fields, error, prepared_at")
      .eq("project_id", projectId)
      .eq("target_platform", platform)
      .maybeSingle();
    return (data as PublishingJobRow | null) ?? null;
  }

  // Selecting a platform loads its existing publishing_jobs row (if any) —
  // the ONE record of this project's preparation for that platform,
  // whatever stage it's at (never a fresh parallel state).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId || !selectedPlatform) {
        if (!cancelled) setJob(null);
        return;
      }
      const data = await fetchJob(selectedPlatform);
      if (cancelled) return;
      setJob(data);
      if (data?.requested_formats?.length) setSelectedFormats(data.requested_formats);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedPlatform]);

  // While the background job is active, poll for progress — the job keeps
  // running server-side (lib/kdp-preparation-department.ts, via cron)
  // whether or not this tab stays open; this just reflects its state.
  useEffect(() => {
    if (!job || !selectedPlatform || !ACTIVE_STATUSES.includes(job.status)) return;
    const interval = setInterval(async () => {
      const data = await fetchJob(selectedPlatform);
      setJob(data);
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, selectedPlatform]);

  const livePreflight: PreflightResult | null = useMemo(
    () => (passport ? runPreflight(passport, selectedFormats, prices) : null),
    [passport, selectedFormats, prices]
  );

  async function handleApprove() {
    if (!projectId) return;
    const { error } = await supabase.from("projects").update({ status: "USER_APPROVED" }).eq("id", projectId);
    if (!error) {
      setApproved(true);
      await supabase.from("publishing_log").insert({ project_id: projectId, event: "User approved the publishing package." });
    }
  }

  async function handleRunPreflight() {
    if (!projectId || !selectedPlatform || !livePreflight) return;
    setPreflightMessage(
      livePreflight.canProceed ? "✓ Preflight passed — no blockers found." : `⚠ ${livePreflight.bookBlockers.length} issue(s) need attention.`
    );
    await supabase.from("publishing_log").insert({
      project_id: projectId,
      event: `Preflight run for ${selectedPlatform}: ${livePreflight.canProceed ? "passed" : `${livePreflight.bookBlockers.length} issue(s) found`}.`,
    });
  }

  async function handlePrepareForKdp() {
    if (!projectId || !selectedPlatform) return;
    setStartingJob(true);
    setPrepareError(null);
    try {
      const res = await fetch("/api/kdp-prepare/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, target_platform: selectedPlatform, requested_formats: selectedFormats }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not start KDP preparation.");
      setJob(await fetchJob(selectedPlatform));
    } catch (e) {
      setPrepareError(e instanceof Error ? e.message : "Could not start KDP preparation.");
    } finally {
      setStartingJob(false);
    }
  }

  async function handleDownloadPackage() {
    if (!projectId || !selectedPlatform) return;
    setDownloadingPackage(true);
    try {
      const res = await fetch(`/api/kdp-package-download?project=${projectId}&platform=${encodeURIComponent(selectedPlatform)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not build a download link.");
      window.open(json.url, "_blank");
    } catch (e) {
      setPrepareError(e instanceof Error ? e.message : "Could not download the package.");
    } finally {
      setDownloadingPackage(false);
    }
  }

  function handleCopy(field: string, value: string) {
    if (navigator.clipboard) navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500);
  }

  async function handleMarkPublished() {
    if (!projectId || !job || !selectedPlatform) return;
    setMarkingPublished(true);
    const now = new Date().toISOString();
    await Promise.all([
      supabase.from("publishing_jobs").update({ status: "user_marked_published", marked_published_at: now }).eq("id", job.id),
      supabase.from("projects").update({ status: "EXPORTED" }).eq("id", projectId),
      supabase.from("publishing_log").insert({ project_id: projectId, event: `User marked as published on ${selectedPlatform}.` }),
    ]);
    setMarkingPublished(false);
    setJob((j) => (j ? { ...j, status: "user_marked_published" } : j));
  }

  const { checks: healthChecks, readinessPct } = passport ? computeBookHealth(passport) : { checks: [], readinessPct: 0 };
  const gate = passport?.qualityGate ?? null;
  const qualityPassed = gate ? gate.contentCheck && gate.structureCheck && gate.continuityCheck && gate.wordCountCheck : null;
  const paperbackEdition = passport?.formatting.editions.find((e) => e.formatType === "paperback") ?? null;
  const hasAnyPrice = Object.values(prices).some((p) => p.trim() !== "");

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
        <h1>📦 Publishing Control Center</h1>

        {!projectId && <p className="hint">No project specified. Head back to your dashboard to pick one.</p>}
        {projectId && loading && <p className="hint">Loading…</p>}
        {projectId && !loading && !passport && <p className="hint">That project couldn&apos;t be found.</p>}

        {passport && (
          <>
            <div className="checklist-panel">
              <div className="check-row">
                <span>Overall Book Health</span>
                <span className={readinessPct === 100 ? "ok" : undefined} style={readinessPct !== 100 ? { color: "#ffc266" } : undefined}>
                  {readinessPct}% ready
                </span>
              </div>
              <div style={{ height: "6px", background: "rgba(255,255,255,.08)", borderRadius: "3px", overflow: "hidden", margin: "2px 0 14px" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${readinessPct}%`,
                    background: readinessPct === 100 ? "#5fe3b8" : "var(--blueGlow)",
                    transition: "width .3s",
                  }}
                />
              </div>
              {healthChecks.map((c) => (
                <CheckRow key={c.label} label={c.label} ok={c.ok} text={c.ok ? "✓ Complete" : "Incomplete"} />
              ))}
              <CheckRow
                label="Paperback — Interior PDF"
                ok={false}
                text="Not available yet — InkFrame doesn't generate a print-ready interior PDF; export the manuscript and lay it out yourself"
              />
              <CheckRow
                label="Paperback — Full Cover PDF"
                ok={paperbackEdition?.status === "ready"}
                text={
                  paperbackEdition?.status === "ready"
                    ? "✓ Generated in Cover Studio"
                    : paperbackEdition
                      ? "Started — finish it in Cover Studio"
                      : "Not started — generate one in Cover Studio"
                }
              />
              <CheckRow
                label="Hardcover — Files"
                ok={false}
                text="Not available yet — InkFrame doesn't generate hardcover interior/cover files; use paperback or eBook for now"
              />
              <CheckRow label="Pricing" ok={hasAnyPrice} text={hasAnyPrice ? "✓ Set below" : "Not set — enter a price below"} />
              <CheckRow label="Quality Checks" ok={qualityPassed} text={gate ? (qualityPassed ? "✓ Passed" : "Needs review") : "Not scored yet"} />
            </div>
            <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: "-6px 0 10px" }}>
              InkFrame&apos;s internal readiness assessment:{" "}
              {gate?.overallReadinessScore != null ? `${gate.overallReadinessScore}/100` : "not scored yet"}. This
              reflects what InkFrame has checked so far — it is not a guarantee of platform acceptance.
            </p>
            <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: "0 0 22px" }}>
              Paperback/hardcover cover dimensions are calculated from this book&apos;s actual trim size and final
              page count — never a generic fixed size. If the page count changes later, the cover is automatically
              flagged for recalculation before this checklist can show all-green again.
            </p>

            <div className="checklist-panel" style={{ marginBottom: "22px" }}>
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>
                Pricing
                {priceSaveState === "saving" && (
                  <span style={{ fontWeight: 400, fontSize: "12px", color: "var(--muted)", marginLeft: "10px" }}>Saving…</span>
                )}
                {priceSaveState === "saved" && (
                  <span style={{ fontWeight: 400, fontSize: "12px", color: "#5fe3b8", marginLeft: "10px" }}>✓ Saved</span>
                )}
              </div>
              {(Object.keys(FORMAT_LABELS) as FormatType[]).map((f) => (
                <div className="check-row" key={f}>
                  <span>{FORMAT_LABELS[f]}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    $
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={prices[f]}
                      onChange={(e) => setPrices((p) => ({ ...p, [f]: e.target.value }))}
                      placeholder={suggestPrice(passport?.scope?.wordsWritten ?? 0)}
                      style={{ width: "80px" }}
                    />
                  </span>
                </div>
              ))}
              <p className="hint" style={{ marginTop: "8px" }}>
                Real prices you set, saved to this book&apos;s format editions as you type — this is what every
                downstream step (Book Health, KDP preparation, the KDP Ready Package) uses. Leave a format blank
                to fall back on InkFrame&apos;s starting suggestion when a listing is prepared below.
              </p>
            </div>

            <div className="checklist-panel" style={{ marginBottom: "22px" }}>
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>
                Rights &amp; AI-Content Disclosure
                {declarationsSaveState === "saving" && (
                  <span style={{ fontWeight: 400, fontSize: "12px", color: "var(--muted)", marginLeft: "10px" }}>Saving…</span>
                )}
                {declarationsSaveState === "saved" && (
                  <span style={{ fontWeight: 400, fontSize: "12px", color: "#5fe3b8", marginLeft: "10px" }}>✓ Saved</span>
                )}
              </div>

              <p className="hint" style={{ marginBottom: "10px" }}>
                Amazon KDP and every other platform ask you to confirm these yourself during upload — InkFrame
                can&apos;t submit either on your behalf, so this just records that you&apos;ve reviewed them.
              </p>

              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                Where does this content&apos;s rights come from?
              </label>
              <select
                value={declarations.rightsBasis}
                onChange={(e) => setDeclarations((d) => ({ ...d, rightsBasis: e.target.value as RightsBasis | "" }))}
                style={{ marginBottom: "10px" }}
              >
                <option value="">— Select —</option>
                {(Object.keys(RIGHTS_BASIS_LABELS) as RightsBasis[]).map((k) => (
                  <option key={k} value={k}>
                    {RIGHTS_BASIS_LABELS[k]}
                  </option>
                ))}
              </select>

              <textarea
                value={declarations.rightsNote}
                onChange={(e) => setDeclarations((d) => ({ ...d, rightsNote: e.target.value }))}
                placeholder="Optional — any notes on licensing/sourcing you want on record for yourself."
                rows={2}
                style={{
                  width: "100%",
                  background: "#0d1626",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  color: "#fff",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  marginBottom: "12px",
                }}
              />

              <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "13px", marginBottom: "14px" }}>
                <input
                  type="checkbox"
                  checked={declarations.rightsConfirmed}
                  onChange={(e) => setDeclarations((d) => ({ ...d, rightsConfirmed: e.target.checked }))}
                  style={{ marginTop: "2px" }}
                />
                <span>I confirm I hold the necessary rights to publish this content.</span>
              </label>

              <p className="hint" style={{ marginBottom: "8px" }}>
                This manuscript was AI-generated. Most platforms — Amazon KDP included — require disclosing
                AI-generated content (not just AI-assisted) during upload. If a meaningful share of the text is
                your own substantial rewrite instead, keep your own record of prompts/edits to support that.
              </p>
              <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={declarations.aiDisclosureAcknowledged}
                  onChange={(e) => setDeclarations((d) => ({ ...d, aiDisclosureAcknowledged: e.target.checked }))}
                  style={{ marginTop: "2px" }}
                />
                <span>I acknowledge this and will disclose AI-generated content where the platform requires it.</span>
              </label>
            </div>

            {!approved ? (
              <div
                style={{
                  background: "rgba(255,180,50,.08)",
                  border: "1px solid rgba(255,180,50,.25)",
                  borderRadius: "14px",
                  padding: "18px 20px",
                  marginBottom: "24px",
                }}
              >
                <div style={{ fontWeight: 700, color: "#ffc266", marginBottom: "6px" }}>⏳ AWAITING YOUR APPROVAL</div>
                <p style={{ fontSize: "12.5px", color: "#d9c8a8", lineHeight: 1.6, marginBottom: "14px" }}>
                  Everything above is complete and ready. Nothing has been sent anywhere yet. Review it, then
                  approve to reveal your publishing controls.
                </p>
                <button
                  className="mark-published-btn"
                  style={{ background: "linear-gradient(135deg,#ffcc66,#ff9d3d)", color: "#241300" }}
                  onClick={handleApprove}
                >
                  ✓ Approve &amp; Continue
                </button>
              </div>
            ) : (
              <>
                <div
                  style={{
                    background: "rgba(255,180,50,.08)",
                    border: "1px solid rgba(255,180,50,.25)",
                    borderRadius: "14px",
                    padding: "18px 20px",
                    marginBottom: "24px",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#5fe3b8" }}>✓ Approved — publishing controls unlocked</div>
                  <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                    Choose a publishing target and the formats you want prepared.
                  </p>
                </div>

                <div style={{ fontWeight: 700, marginBottom: "12px" }}>Publishing Target</div>
                <div className="platform-grid">
                  {(Object.keys(PLATFORM_LINKS) as Platform[]).map((platform) => (
                    <div
                      key={platform}
                      className={`platform-card${selectedPlatform === platform ? " selected" : ""}`}
                      onClick={() => setSelectedPlatform(platform)}
                    >
                      <div className="pi">{PLATFORM_ICONS[platform]}</div>
                      {platform}
                    </div>
                  ))}
                </div>

                {selectedPlatform && (
                  <>
                    <div className="checklist-panel" style={{ marginTop: "20px", marginBottom: "22px" }}>
                      <div style={{ fontWeight: 700, marginBottom: "10px" }}>Formats to Prepare for {selectedPlatform}</div>
                      {ALL_FORMATS.map((f) => (
                        <label key={f} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", fontSize: "13.5px", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={selectedFormats.includes(f)}
                            onChange={(e) =>
                              setSelectedFormats((prev) => (e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)))
                            }
                          />
                          {FORMAT_LABELS[f]}
                          {f === "hardcover" && (
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>(needs manual completion — InkFrame can&apos;t generate hardcover files yet)</span>
                          )}
                        </label>
                      ))}
                    </div>

                    <div className="checklist-panel" style={{ marginBottom: "22px" }}>
                      <div style={{ fontWeight: 700, marginBottom: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>KDP Preflight</span>
                        <button className="copy-btn" onClick={handleRunPreflight}>
                          Run Full Preflight
                        </button>
                      </div>
                      {livePreflight && livePreflight.bookBlockers.length > 0 ? (
                        <>
                          <p style={{ color: "#ffc266", fontSize: "13px", marginBottom: "8px" }}>
                            Cannot prepare for KDP yet. {livePreflight.bookBlockers.length} issue(s) need attention:
                          </p>
                          {livePreflight.bookBlockers.map((b) => (
                            <div className="check-row" key={b.label}>
                              <span>{b.label}</span>
                              <button className="copy-btn" onClick={() => router.push(b.route)}>
                                Fix
                              </button>
                            </div>
                          ))}
                        </>
                      ) : (
                        livePreflight && <p style={{ color: "#5fe3b8", fontSize: "13px" }}>✓ Ready to prepare — no blockers found.</p>
                      )}
                      {livePreflight && (
                        <div style={{ marginTop: "10px" }}>
                          {livePreflight.formats
                            .filter((f) => f.requested)
                            .map((f) => (
                              <div className="check-row" key={f.format}>
                                <span style={{ textTransform: "capitalize" }}>{f.format}</span>
                                <span style={{ color: f.ready ? "#5fe3b8" : f.supported ? "#ffc266" : "var(--muted)" }}>
                                  {f.ready ? "✓ Ready" : !f.supported ? "Not supported yet" : "Needs attention"}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                      {preflightMessage && (
                        <p className="hint" style={{ marginTop: "8px" }}>
                          {preflightMessage}
                        </p>
                      )}
                    </div>

                    <div className="checklist-panel" style={{ marginBottom: "22px" }}>
                      <div style={{ fontWeight: 700, marginBottom: "10px" }}>Background Publishing Preparation</div>

                      {(!job || !ACTIVE_STATUSES.includes(job.status)) && job?.status !== "needs_attention" && (
                        <>
                          <p className="hint" style={{ marginBottom: "10px" }}>
                            InkFrame will validate everything, then build a complete KDP Ready Package. You can
                            close this page — preparation continues in the background, and you can check back
                            once it&apos;s done.
                          </p>
                          <button className="mark-published-btn" onClick={handlePrepareForKdp} disabled={startingJob || !livePreflight?.canProceed}>
                            {startingJob ? "Starting…" : job ? "Prepare Again" : "Prepare for KDP"}
                          </button>
                        </>
                      )}

                      {job && ACTIVE_STATUSES.includes(job.status) && (
                        <>
                          <p style={{ color: "#ffc266", fontSize: "13px", marginBottom: "10px" }}>
                            Preparing &quot;{passport.identity?.workingTitle || "your book"}&quot; for {selectedPlatform}…
                          </p>
                          {job.stages.map((s) => (
                            <div className="check-row" key={s.key}>
                              <span>{s.label}</span>
                              <span style={{ color: stageStatusColor(s.status) }}>{stageStatusText(s.status)}</span>
                            </div>
                          ))}
                          <p className="hint" style={{ marginTop: "10px", marginBottom: "10px" }}>
                            Running in the background — you can leave this page and come back later.
                          </p>
                          <button className="copy-btn" onClick={() => router.push(`/passport?project=${projectId}`)}>
                            Continue Working
                          </button>
                        </>
                      )}

                      {job && job.status === "needs_attention" && (
                        <>
                          <p style={{ color: "var(--red)", fontSize: "13px", marginBottom: "10px" }}>
                            {job.error || "Preparation needs attention."}
                          </p>
                          {job.stages.map((s) => (
                            <div className="check-row" key={s.key}>
                              <span>{s.label}</span>
                              <span style={{ color: stageStatusColor(s.status) }}>{stageStatusText(s.status)}</span>
                            </div>
                          ))}
                          <button className="mark-published-btn" style={{ marginTop: "10px" }} onClick={handlePrepareForKdp} disabled={startingJob}>
                            {startingJob ? "Retrying…" : "Retry"}
                          </button>
                        </>
                      )}
                    </div>

                    {prepareError && <p style={{ color: "var(--red)", fontSize: "13px", marginBottom: "16px" }}>{prepareError}</p>}

                    {job && !ACTIVE_STATUSES.includes(job.status) && job.status !== "needs_attention" && job.prepared_fields && (
                      <div className="prepared-panel show">
                        <div style={{ fontWeight: 700, marginBottom: "4px" }}>Ready for KDP</div>
                        <p className="hint" style={{ marginBottom: "16px" }}>
                          {job.prepared_at ? `Prepared ${new Date(job.prepared_at).toLocaleString()}. ` : ""}
                          Review everything below, then open {selectedPlatform} to finish the upload — the final
                          publish decision is always yours.
                        </p>

                        {(
                          [
                            ["title", "Title", job.prepared_fields.title],
                            ["description", "Description", job.prepared_fields.description],
                            ["keywords", "Keywords (7)", job.prepared_fields.keywords],
                            ["category", "Recommended Category", job.prepared_fields.category],
                            ["price", "Suggested Price", `$${job.prepared_fields.price}`],
                          ] as const
                        ).map(([key, label, value]) => (
                          <div className="pf-row" key={key}>
                            <label>{label}</label>
                            <div className="pf-value">
                              <div className="pf-text">{value}</div>
                              <button className="copy-btn" onClick={() => handleCopy(key, value)}>
                                {copiedField === key ? "✓ Copied" : "Copy"}
                              </button>
                            </div>
                          </div>
                        ))}

                        <div style={{ marginBottom: "16px" }}>
                          <div style={{ fontWeight: 700, fontSize: "12px", textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)", marginBottom: "6px" }}>
                            Formats
                          </div>
                          {job.requested_formats.map((f) => {
                            const fr = livePreflight?.formats.find((x) => x.format === f);
                            return (
                              <div className="check-row" key={f}>
                                <span style={{ textTransform: "capitalize" }}>{f}</span>
                                <span style={{ color: fr?.ready ? "#5fe3b8" : "var(--muted)" }}>
                                  {fr?.ready ? "✓ ready" : fr?.supported ? "needs manual completion" : "not supported yet"}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        <div style={{ fontWeight: 700, fontSize: "12px", textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)", marginBottom: "6px" }}>
                          KDP Status
                        </div>
                        <p className="hint" style={{ marginBottom: "16px" }}>
                          Ready for manual completion — InkFrame has no official KDP integration to create or
                          verify a draft, so nothing has been submitted anywhere on your behalf.
                        </p>

                        {job.package_ref && (
                          <button className="copy-btn" style={{ width: "100%", marginBottom: "12px", padding: "12px" }} onClick={handleDownloadPackage} disabled={downloadingPackage}>
                            {downloadingPackage ? "Preparing download…" : "⇩ Download KDP Ready Package (.zip)"}
                          </button>
                        )}

                        <a href={PLATFORM_LINKS[selectedPlatform]} className="kdp-link-btn" target="_blank" rel="noreferrer">
                          Open {selectedPlatform} Bookshelf ↗
                        </a>

                        {job.status === "user_marked_published" ? (
                          <button className="mark-published-btn" disabled>
                            ✓ Marked as Published
                          </button>
                        ) : (
                          <button className="mark-published-btn" onClick={handleMarkPublished} disabled={markingPublished}>
                            {markingPublished ? "Saving…" : "✓ I've Published This"}
                          </button>
                        )}

                        <div className="safety-note">
                          ✦ InkFrame prepares everything above for you to review and use — it never logs into or
                          submits directly to your publishing account. You always make the final upload yourself, on
                          your own platform login.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function PublishPage() {
  return (
    <Suspense fallback={null}>
      <PublishBody />
    </Suspense>
  );
}

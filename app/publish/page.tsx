"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/publish";
import { assembleBookPassport, computeBookHealth, type BookPassport } from "@/lib/book-passport";

export const dynamic = "force-dynamic";

type Platform = "Amazon KDP" | "Kobo" | "Google Play Books" | "Apple Books";
type FormatType = "ebook" | "paperback" | "hardcover";
const FORMAT_LABELS: Record<FormatType, string> = { ebook: "Kindle eBook", paperback: "Paperback", hardcover: "Hardcover" };

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

// A starting suggestion only — InkFrame may suggest a price, never auto-sets one.
function suggestPrice(totalWords: number): string {
  if (totalWords < 20000) return "2.99";
  if (totalWords < 50000) return "3.99";
  if (totalWords < 90000) return "4.99";
  return "5.99";
}

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

function PublishBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const supabase = createClient();

  const [projectStatus, setProjectStatus] = useState<string | null>(null);
  const [passport, setPassport] = useState<BookPassport | null>(null);
  const [loading, setLoading] = useState(!!projectId);
  const [approved, setApproved] = useState(false);

  const [prices, setPrices] = useState<Record<FormatType, string>>({ ebook: "", paperback: "", hardcover: "" });
  const [priceSaveState, setPriceSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const priceSkipAutosave = useRef(true);

  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [publishingJobId, setPublishingJobId] = useState<string | null>(null);
  const [preparedFields, setPreparedFields] = useState<{
    title: string;
    description: string;
    keywords: string;
    category: string;
    price: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [markingPublished, setMarkingPublished] = useState(false);
  const [published, setPublished] = useState(false);

  useEffect(() => {
    document.title = pageTitle;
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const [result, { data: editions }] = await Promise.all([
        assembleBookPassport(supabase, projectId),
        supabase.from("format_editions").select("format_type, price").eq("project_id", projectId),
      ]);
      if (cancelled || !result) return;
      setPassport(result);
      setProjectStatus(result.workflowStage);
      priceSkipAutosave.current = true;
      const priceByFormat: Record<FormatType, string> = { ebook: "", paperback: "", hardcover: "" };
      for (const e of editions ?? []) {
        const formatType = e.format_type as FormatType;
        if (e.price != null && (formatType === "ebook" || formatType === "paperback" || formatType === "hardcover")) {
          priceByFormat[formatType] = String(e.price);
        }
      }
      setPrices(priceByFormat);
      setApproved(["USER_APPROVED", "READY_FOR_EXPORT", "EXPORTED"].includes(result.workflowStage));
      setPublished(result.workflowStage === "EXPORTED");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Real per-format pricing, debounced-autosaved to format_editions — never
  // silently overwritten by a suggestion once the author has set a real
  // value (see suggestPrice below, only used as a fallback display).
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

  async function handleApprove() {
    if (!projectId) return;
    const { error } = await supabase.from("projects").update({ status: "USER_APPROVED" }).eq("id", projectId);
    if (!error) {
      setApproved(true);
      await supabase.from("publishing_log").insert({ project_id: projectId, event: "User approved the publishing package." });
    }
  }

  async function handleSelectPlatform(platform: Platform) {
    if (!projectId) return;
    setSelectedPlatform(platform);
    setPreparing(true);
    setPrepareError(null);
    try {
      const prepared = {
        title: passport?.identity?.workingTitle || "Untitled Project",
        description: "", // filled below via metadata_department, not tracked on the passport type
        keywords: "",
        category: "",
        price: prices.ebook.trim() ? prices.ebook : suggestPrice(passport?.scope?.wordsWritten ?? 0),
      };
      const { data: meta } = await supabase
        .from("metadata_department")
        .select("description_long, keywords, categories")
        .eq("project_id", projectId)
        .maybeSingle();
      prepared.description = meta?.description_long || "No description generated yet.";
      prepared.keywords = (meta?.keywords ?? []).join(", ") || "No keywords generated yet.";
      prepared.category = meta?.categories?.[0] || "Not yet categorized";

      const { data: job, error } = await supabase
        .from("publishing_jobs")
        .upsert(
          {
            project_id: projectId,
            target_platform: platform,
            readiness_snapshot: passport?.qualityGate ?? {},
            prepared_fields: prepared,
            status: "ready_for_review",
          },
          { onConflict: "project_id,target_platform" }
        )
        .select()
        .single();

      if (error) throw new Error(error.message);

      setPublishingJobId(job.id);
      setPreparedFields(prepared);
      await supabase.from("projects").update({ status: "READY_FOR_EXPORT" }).eq("id", projectId);
      await supabase.from("publishing_log").insert({ project_id: projectId, event: `Publishing package prepared for ${platform}.` });
    } catch (e) {
      setPrepareError(e instanceof Error ? e.message : "Could not prepare this listing.");
    } finally {
      setPreparing(false);
    }
  }

  function handleCopy(field: string, value: string) {
    if (navigator.clipboard) navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500);
  }

  async function handleMarkPublished() {
    if (!projectId || !publishingJobId || !selectedPlatform) return;
    setMarkingPublished(true);
    const now = new Date().toISOString();
    await Promise.all([
      supabase
        .from("publishing_jobs")
        .update({ status: "user_marked_published", marked_published_at: now })
        .eq("id", publishingJobId),
      supabase.from("projects").update({ status: "EXPORTED" }).eq("id", projectId),
      supabase
        .from("publishing_log")
        .insert({ project_id: projectId, event: `User marked as published on ${selectedPlatform}.` }),
    ]);
    setMarkingPublished(false);
    setPublished(true);
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
        <h1>📦 Book Complete — Ready to Publish</h1>

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
                label="Pricing"
                ok={hasAnyPrice}
                text={hasAnyPrice ? "✓ Set below" : "Not set — enter a price below"}
              />
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
                Real prices you set, saved to this book&apos;s format editions as you type. Leave a format blank
                to fall back on InkFrame&apos;s starting suggestion when a listing is prepared below.
              </p>
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
                  approve to reveal your publishing package.
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
                  <div style={{ fontWeight: 700, color: "#5fe3b8" }}>✓ Approved — package ready</div>
                  <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                    Choose a platform below to see your prepared listing and open its real bookshelf.
                  </p>
                </div>

                <div style={{ fontWeight: 700, marginBottom: "12px" }}>Where do you want to publish?</div>
                <div className="platform-grid">
                  {(Object.keys(PLATFORM_LINKS) as Platform[]).map((platform) => (
                    <div
                      key={platform}
                      className={`platform-card${selectedPlatform === platform ? " selected" : ""}`}
                      onClick={() => handleSelectPlatform(platform)}
                    >
                      <div className="pi">{PLATFORM_ICONS[platform]}</div>
                      {platform}
                    </div>
                  ))}
                </div>

                {preparing && <p className="hint" style={{ marginTop: "16px" }}>Preparing your listing…</p>}
                {prepareError && (
                  <p style={{ color: "var(--red)", fontSize: "13px", marginTop: "16px" }}>{prepareError}</p>
                )}

                {preparedFields && selectedPlatform && !preparing && (
                  <div className="prepared-panel show">
                    <div style={{ fontWeight: 700, marginBottom: "16px" }}>
                      Your {selectedPlatform} listing is ready
                    </div>

                    {(
                      [
                        ["title", "Title", preparedFields.title],
                        ["description", "Description", preparedFields.description],
                        ["keywords", "Keywords (7)", preparedFields.keywords],
                        ["category", "Recommended Category", preparedFields.category],
                        ["price", "Suggested Price", `$${preparedFields.price}`],
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

                    <a href={PLATFORM_LINKS[selectedPlatform]} className="kdp-link-btn" target="_blank" rel="noreferrer">
                      Open {selectedPlatform} Bookshelf ↗
                    </a>

                    {published ? (
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

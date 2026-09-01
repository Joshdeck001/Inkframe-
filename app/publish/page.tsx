"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/publish";

export const dynamic = "force-dynamic";

type QualityGate = {
  content_check: boolean;
  structure_check: boolean;
  continuity_check: boolean;
  word_count_check: boolean;
  metadata_check: boolean;
  formatting_check: boolean;
  cover_check: boolean;
  overall_readiness_score: number;
};

type Platform = "Amazon KDP" | "Kobo" | "Google Play Books" | "Apple Books";

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
  const [gate, setGate] = useState<QualityGate | null>(null);
  const [loading, setLoading] = useState(!!projectId);
  const [approved, setApproved] = useState(false);

  const [identity, setIdentity] = useState<{ working_title: string | null } | null>(null);
  const [metadata, setMetadata] = useState<{ description_long: string | null; keywords: string[]; categories: string[] } | null>(null);
  const [totalWords, setTotalWords] = useState(0);

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
      const [{ data: proj }, { data: gateRow }, { data: id }, { data: meta }, { data: scope }] = await Promise.all([
        supabase.from("projects").select("status").eq("id", projectId).single(),
        supabase.from("quality_gate").select("*").eq("project_id", projectId).maybeSingle(),
        supabase.from("project_identity").select("working_title").eq("project_id", projectId).single(),
        supabase.from("metadata_department").select("description_long, keywords, categories").eq("project_id", projectId).maybeSingle(),
        supabase.from("project_scope").select("words_written").eq("project_id", projectId).maybeSingle(),
      ]);
      if (cancelled) return;
      setProjectStatus(proj?.status ?? null);
      setGate((gateRow as QualityGate) ?? null);
      setIdentity(id ?? null);
      setMetadata(meta ?? null);
      setTotalWords(scope?.words_written ?? 0);
      setApproved(!!proj && ["USER_APPROVED", "READY_FOR_EXPORT", "EXPORTED"].includes(proj.status));
      setPublished(proj?.status === "EXPORTED");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, supabase]);

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
        title: identity?.working_title || "Untitled Project",
        description: metadata?.description_long || "No description generated yet.",
        keywords: (metadata?.keywords ?? []).join(", ") || "No keywords generated yet.",
        category: metadata?.categories?.[0] || "Not yet categorized",
        price: suggestPrice(totalWords),
      };

      const { data: job, error } = await supabase
        .from("publishing_jobs")
        .upsert(
          {
            project_id: projectId,
            target_platform: platform,
            readiness_snapshot: gate ?? {},
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

  const qualityPassed = gate ? gate.content_check && gate.structure_check && gate.continuity_check && gate.word_count_check : null;

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
        {projectId && !loading && !gate && (
          <p className="hint">The Final Quality Gate hasn&apos;t run for this project yet — it runs automatically once Formatting finishes.</p>
        )}

        {gate && (
          <>
            <div className="checklist-panel">
              <CheckRow label="Metadata" ok={gate.metadata_check} text={gate.metadata_check ? "✓ Complete" : "Incomplete"} />
              <CheckRow label="eBook — Manuscript" ok={gate.formatting_check} text={gate.formatting_check ? "✓ Ready (.docx)" : "Not ready"} />
              <CheckRow
                label="eBook — Cover (JPEG)"
                ok={gate.cover_check ? null : false}
                text={gate.cover_check ? "Concepts drafted — no artwork yet" : "Not started"}
              />
              <CheckRow label="Paperback — Interior PDF" ok={false} text="Not available yet" />
              <CheckRow label="Paperback — Full Cover PDF" ok={false} text="Not available yet" />
              <CheckRow label="Pricing" ok={false} text="Not set — a suggestion appears once you pick a platform below" />
              <CheckRow label="Quality Checks" ok={qualityPassed} text={qualityPassed ? "✓ Passed" : "Needs review"} />
            </div>
            <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: "-6px 0 10px" }}>
              InkFrame&apos;s internal readiness assessment: {gate.overall_readiness_score}/100. This reflects what
              InkFrame has checked so far — it is not a guarantee of platform acceptance.
            </p>
            <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: "0 0 22px" }}>
              Paperback/hardcover cover dimensions are calculated from this book&apos;s actual trim size and final
              page count — never a generic fixed size. If the page count changes later, the cover is automatically
              flagged for recalculation before this checklist can show all-green again.
            </p>

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

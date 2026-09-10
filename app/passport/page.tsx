"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { assembleBookPassport, type BookPassport } from "@/lib/book-passport";

export const dynamic = "force-dynamic";

function StatusBadge({ text, tone }: { text: string; tone: "ok" | "warn" | "muted" }) {
  const color = tone === "ok" ? "#5fe3b8" : tone === "warn" ? "#ffc266" : "var(--muted)";
  return <span style={{ color, fontWeight: 700 }}>{text}</span>;
}

function PassportBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const supabase = createClient();

  const [passport, setPassport] = useState<BookPassport | null>(null);
  const [loading, setLoading] = useState(!!projectId);
  const [notFound, setNotFound] = useState(false);
  const [packaging, setPackaging] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);

  async function handleDownloadPackage() {
    if (!projectId) return;
    setPackaging(true);
    setPackageError(null);
    try {
      const res = await fetch(`/api/production-package?project=${projectId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not build the production package.");
      window.open(json.url, "_blank");
    } catch (e) {
      setPackageError(e instanceof Error ? e.message : "Could not build the production package.");
    } finally {
      setPackaging(false);
    }
  }

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const result = await assembleBookPassport(supabase, projectId);
      if (cancelled) return;
      setPassport(result);
      setNotFound(!result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (!projectId) {
    return (
      <div className="empty-panel">
        <div className="ei">🪪</div>
        <h3>No project selected</h3>
        <p>Open a book from My Books to see its Book Passport.</p>
        <button className="btn btn-primary" onClick={() => router.push("/books")}>
          Go to My Books
        </button>
      </div>
    );
  }

  if (loading) return <p className="hint">Loading Book Passport…</p>;
  if (notFound || !passport) return <p className="hint">That project couldn&apos;t be found.</p>;

  const title = passport.identity?.workingTitle || "Untitled Project";

  // Book Health Check — deterministic checks computed from real data already
  // assembled above, never a fabricated percentage. Paperback only counts
  // if the author actually generated one (it's opt-in, see the Cover Studio
  // print-cover feature) — a book that never wanted a paperback isn't
  // penalized for not having one.
  const paperbackEdition = passport.formatting.editions.find((e) => e.formatType === "paperback");
  const healthChecks: { label: string; ok: boolean; route: string }[] = [
    { label: "Manuscript (all chapters approved)", ok: passport.chapters.total > 0 && passport.chapters.approved === passport.chapters.total, route: `/formatter?project=${projectId}` },
    { label: "Ebook formatting (DOCX/EPUB)", ok: passport.ebookFormatting.status === "complete", route: `/formatter?project=${projectId}` },
    { label: "Cover", ok: passport.cover.status === "done", route: `/cover?project=${projectId}` },
    { label: "Metadata", ok: passport.metadata.status === "done", route: `/metadata?project=${projectId}` },
    { label: "Quality gate scored", ok: !!passport.qualityGate?.overallReadinessScore, route: `/publish?project=${projectId}` },
    ...(paperbackEdition ? [{ label: "Paperback print cover", ok: paperbackEdition.status === "ready", route: `/cover?project=${projectId}` }] : []),
  ];
  const readinessPct = Math.round((healthChecks.filter((c) => c.ok).length / healthChecks.length) * 100);

  return (
    <>
      <div className="panel" style={{ borderColor: readinessPct === 100 ? "#5fe3b8" : undefined }}>
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>
          Book Health: <span style={{ color: readinessPct === 100 ? "#5fe3b8" : "#ffc266" }}>{readinessPct}% Ready</span>
        </div>
        {healthChecks.map((c) => (
          <div className="check-row" key={c.label}>
            <span>{c.ok ? "✓" : "⚠"} {c.label}</span>
            {!c.ok && (
              <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "12px" }} onClick={() => router.push(c.route)}>
                Fix
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "4px" }}>{title}</div>
        {passport.identity?.subtitle && <div className="hint" style={{ marginBottom: "10px" }}>{passport.identity.subtitle}</div>}
        <div className="check-row">
          <span>Author</span>
          <span>{passport.identity?.penName || passport.identity?.authorName || "—"}</span>
        </div>
        {passport.identity?.seriesName && (
          <div className="check-row">
            <span>Series</span>
            <span>
              {passport.identity.seriesName}
              {passport.identity.seriesNumber ? ` #${passport.identity.seriesNumber}` : ""}
            </span>
          </div>
        )}
        <div className="check-row">
          <span>Book type</span>
          <span>{passport.bookType}</span>
        </div>
        <div className="check-row">
          <span>Language</span>
          <span>{passport.identity?.language || "—"}</span>
        </div>
        <div className="check-row">
          <span>Current stage</span>
          <span>{passport.workflowStage.replace(/_/g, " ")}</span>
        </div>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>Audience &amp; Style</div>
        <div className="check-row">
          <span>Target audience</span>
          <span>{passport.audience?.targetAudience || "—"}</span>
        </div>
        <div className="check-row">
          <span>Tone / POV / Pacing</span>
          <span>{[passport.style?.tone, passport.style?.pov, passport.style?.pacing].filter(Boolean).join(" / ") || "—"}</span>
        </div>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>Manuscript</div>
        <div className="check-row">
          <span>Chapters</span>
          <span>
            {passport.chapters.approved} of {passport.chapters.total} approved
          </span>
        </div>
        <div className="check-row">
          <span>Words written</span>
          <span>
            {(passport.scope?.wordsWritten ?? 0).toLocaleString()}
            {passport.scope?.targetWordCount ? ` / ${passport.scope.targetWordCount.toLocaleString()} target` : ""}
          </span>
        </div>
        <div className="check-row">
          <span>Trim size</span>
          <span>{passport.scope?.trimSize || "—"}</span>
        </div>
        <div style={{ marginTop: "10px" }}>
          <button className="btn btn-secondary" onClick={() => router.push(`/formatter?project=${projectId}`)}>
            Open Manuscript / Formatter
          </button>
        </div>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>Quality</div>
        {passport.qualityGate ? (
          <div className="check-row">
            <span>Internal readiness score</span>
            <StatusBadge
              text={passport.qualityGate.overallReadinessScore != null ? `${passport.qualityGate.overallReadinessScore}/100 (internal, not a guarantee)` : "not scored yet"}
              tone={passport.qualityGate.overallReadinessScore != null && passport.qualityGate.overallReadinessScore >= 70 ? "ok" : "warn"}
            />
          </div>
        ) : (
          <div className="check-row">
            <span>Quality gate</span>
            <StatusBadge text="not run yet" tone="muted" />
          </div>
        )}
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>Production Status</div>
        <div className="check-row">
          <span>Cover</span>
          <StatusBadge
            text={passport.cover.status === "done" ? "done" : passport.cover.status === "in_progress" ? "in progress" : "not started"}
            tone={passport.cover.status === "done" ? "ok" : passport.cover.status === "in_progress" ? "warn" : "muted"}
          />
        </div>
        <div className="check-row">
          <span>Metadata</span>
          <StatusBadge text={passport.metadata.status === "done" ? "done" : "not started"} tone={passport.metadata.status === "done" ? "ok" : "muted"} />
        </div>
        {passport.formatting.editions.length > 0 ? (
          passport.formatting.editions.map((e) => (
            <div className="check-row" key={e.formatType}>
              <span style={{ textTransform: "capitalize" }}>{e.formatType}</span>
              <StatusBadge text={e.status.replace(/_/g, " ")} tone={e.status === "ready" ? "ok" : e.status === "error" ? "warn" : "muted"} />
            </div>
          ))
        ) : (
          <div className="check-row">
            <span>Formatting</span>
            <StatusBadge text="not started" tone="muted" />
          </div>
        )}
        <div className="check-row">
          <span>Audiobook</span>
          <StatusBadge
            text={passport.audiobook ? passport.audiobook.status!.replace(/_/g, " ") : "not started"}
            tone={passport.audiobook?.status === "complete" ? "ok" : passport.audiobook ? "warn" : "muted"}
          />
        </div>
        <div className="check-row">
          <span>Marketing</span>
          <StatusBadge text={passport.marketing.hasStrategy ? "strategy drafted" : "not started"} tone={passport.marketing.hasStrategy ? "ok" : "muted"} />
        </div>
        {passport.translations.length > 0 && (
          <div className="check-row">
            <span>Translations</span>
            <span>{passport.translations.map((t) => `${t.language} (${t.status || "pending"})`).join(", ")}</span>
          </div>
        )}
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: "10px" }}>Take Action</div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={() => router.push(`/cover?project=${projectId}`)}>
            Cover Studio
          </button>
          <button className="btn btn-secondary" onClick={() => router.push(`/metadata?project=${projectId}`)}>
            Metadata Studio
          </button>
          <button className="btn btn-secondary" onClick={() => router.push(`/translate?project=${projectId}`)}>
            Translation
          </button>
          <button className="btn btn-secondary" onClick={() => router.push(`/audiobook?project=${projectId}`)}>
            Audiobook Studio
          </button>
          <button className="btn btn-secondary" onClick={() => router.push(`/advertising?project=${projectId}`)}>
            Marketing
          </button>
          <button className="btn btn-primary" onClick={() => router.push(`/publish?project=${projectId}`)}>
            Publishing Preparation
          </button>
        </div>
        <button className="btn btn-secondary" style={{ marginTop: "12px" }} onClick={handleDownloadPackage} disabled={packaging}>
          {packaging ? "Building package…" : "⇩ Download Production Package (.zip)"}
        </button>
        {packageError && <p style={{ color: "var(--red)", fontSize: "13px", marginTop: "8px" }}>{packageError}</p>}
        <p className="hint" style={{ marginTop: "8px" }}>
          Manuscript + cover + metadata + this Book Passport, bundled so you can take the project elsewhere.
          Requires manuscript formatting to be complete.
        </p>
      </div>
    </>
  );
}

export default function BookPassportPage() {
  const router = useRouter();
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
        <h1>🪪 Book Passport</h1>
        <p className="subtitle">Everything InkFrame knows about this book, in one place — read-only; edit each part from its own studio.</p>
        <Suspense fallback={<p className="hint">Loading…</p>}>
          <PassportBody />
        </Suspense>
      </div>
    </>
  );
}

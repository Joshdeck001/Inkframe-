"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, script, title as pageTitle } from "@/content/publish";
import { bottomHtml } from "@/content/publish-bottom";

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

  const [gate, setGate] = useState<QualityGate | null>(null);
  const [loading, setLoading] = useState(!!projectId);

  useEffect(() => {
    document.title = pageTitle;
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("quality_gate").select("*").eq("project_id", projectId).maybeSingle();
      if (!cancelled) {
        setGate((data as QualityGate) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, supabase]);

  useEffect(() => {
    const el = document.createElement("script");
    el.textContent = script;
    document.body.appendChild(el);
    return () => {
      document.body.removeChild(el);
    };
  }, []);

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
              <CheckRow label="Pricing" ok={false} text="Not set" />
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
          </>
        )}

        <div dangerouslySetInnerHTML={{ __html: bottomHtml }} />
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

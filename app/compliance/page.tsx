"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { useMyProjects } from "@/lib/useMyProjects";
import ProjectPicker from "@/lib/ProjectPicker";

export const dynamic = "force-dynamic";

type ComplianceCheck = { id: string; check_type: string; status: string; detail: string };

export default function CompliancePage() {
  const router = useRouter();
  const supabase = createClient();
  const projects = useMyProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? (projects && projects.length > 0 ? projects[0].id : null);
  const [checks, setChecks] = useState<ComplianceCheck[] | null>(null);

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    (async () => {
      setChecks(null);
      const { data } = await supabase
        .from("compliance_checks")
        .select("id, check_type, status, detail")
        .eq("project_id", effectiveId)
        .order("checked_at", { ascending: false });
      if (!cancelled) setChecks(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, supabase]);

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
        <h1>✓ Compliance Check</h1>
        <p className="subtitle">
          Deterministic checks against real platform rules — never a guarantee of platform approval.
        </p>

        <ProjectPicker projects={projects} selectedId={effectiveId} onSelect={setSelectedId} />

        {effectiveId && (
          <div className="panel">
            {checks === null && <p className="hint">Loading…</p>}
            {checks && checks.length === 0 && (
              <p className="hint">No compliance checks yet for this book — they run automatically once metadata is generated.</p>
            )}
            {checks?.map((c) => (
              <div key={c.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <div className="check-row" style={{ borderTop: "none", padding: 0 }}>
                  <span>{c.check_type.replace(/_/g, " ")}</span>
                  <span
                    style={{
                      color:
                        c.status === "pass" ? "#5fe3b8" : c.status === "action_required" ? "#ff8595" : "#ffc266",
                      fontWeight: 700,
                    }}
                  >
                    {c.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="hint" style={{ marginTop: "4px" }}>{c.detail}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

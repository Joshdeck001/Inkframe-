"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";

export const dynamic = "force-dynamic";

type ActivityRow = { id: string; event: string; occurred_at: string; project_id: string; title: string };

/**
 * Reads publishing_log — the same real-events-only table every department
 * (import, research, audiobook, print-cover, publishing prep) already
 * writes to — across every project the user owns, instead of one project
 * at a time. No new activity table: this is a view over what already
 * exists, per the "don't duplicate" instruction.
 */
export default function ActivityPage() {
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: projects } = await supabase
        .from("projects")
        .select("id, project_identity(working_title)")
        .eq("user_id", user.id);
      if (cancelled || !projects || projects.length === 0) {
        setRows([]);
        return;
      }
      const titleById = new Map(
        (projects as unknown as { id: string; project_identity: { working_title: string | null } | null }[]).map((p) => [
          p.id,
          p.project_identity?.working_title || "Untitled Project",
        ])
      );
      const { data: log } = await supabase
        .from("publishing_log")
        .select("id, event, occurred_at, project_id")
        .in("project_id", [...titleById.keys()])
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (!cancelled) {
        setRows((log ?? []).map((r) => ({ ...r, title: titleById.get(r.project_id) ?? "Untitled Project" })));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

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
        <h1>🕓 Activity</h1>
        <p className="subtitle">Real events across every one of your books — nothing here is predicted or invented.</p>

        {rows === null && <p className="hint">Loading…</p>}

        {rows && rows.length === 0 && (
          <div className="empty-panel">
            <div className="ei">🕓</div>
            <h3>No activity yet</h3>
            <p>Actions like research runs, audiobook narration, and publishing prep will show up here as they happen.</p>
            <button className="btn btn-primary" onClick={() => router.push("/books")}>
              Go to My Books
            </button>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="panel">
            {rows.map((r) => (
              <div className="check-row" key={r.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/passport?project=${r.project_id}`)}>
                <span>
                  <span style={{ color: "var(--blueGlow)", fontWeight: 600 }}>{r.title}</span> — {r.event}
                </span>
                <span className="hint">{new Date(r.occurred_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

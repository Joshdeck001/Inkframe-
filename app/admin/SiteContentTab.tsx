"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type SiteContentRow = {
  id: string;
  key: string;
  value: string | null;
  content_type: "text" | "color" | "image" | "link" | "carousel_slide";
  page: "landing" | "auth" | "dashboard" | "wizard" | "job_progress" | "global";
  locked: boolean;
  updated_at: string;
};

const PAGES: SiteContentRow["page"][] = ["landing", "auth", "dashboard", "wizard", "job_progress", "global"];
const CONTENT_TYPES: SiteContentRow["content_type"][] = ["text", "color", "image", "link", "carousel_slide"];

export default function SiteContentTab({ supabase }: { supabase: SupabaseClient }) {
  const [rows, setRows] = useState<SiteContentRow[] | null>(null);
  const [pageFilter, setPageFilter] = useState<"all" | SiteContentRow["page"]>("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newKey, setNewKey] = useState("");
  const [newPage, setNewPage] = useState<SiteContentRow["page"]>("global");
  const [newType, setNewType] = useState<SiteContentRow["content_type"]>("text");
  const [newValue, setNewValue] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("site_content")
      .select("id, key, value, content_type, page, locked, updated_at")
      .order("page", { ascending: true })
      .order("key", { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setRows((data ?? []) as SiteContentRow[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await supabase
        .from("site_content")
        .select("id, key, value, content_type, page, locked, updated_at")
        .order("page", { ascending: true })
        .order("key", { ascending: true });
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setRows((data ?? []) as SiteContentRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleSave(row: SiteContentRow) {
    const draft = drafts[row.id];
    if (draft === undefined || draft === row.value) return;
    setSavingId(row.id);
    setError(null);
    const { error: updateError } = await supabase.from("site_content").update({ value: draft }).eq("id", row.id);
    setSavingId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await load();
  }

  async function handleDelete(row: SiteContentRow) {
    if (!confirm(`Delete "${row.key}"? This can't be undone.`)) return;
    const { error: deleteError } = await supabase.from("site_content").delete().eq("id", row.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await load();
  }

  async function handleCreate() {
    if (!newKey.trim()) return;
    setCreating(true);
    setError(null);
    const { error: insertError } = await supabase
      .from("site_content")
      .insert({ key: newKey.trim(), page: newPage, content_type: newType, value: newValue });
    setCreating(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewKey("");
    setNewValue("");
    await load();
  }

  const visibleRows = (rows ?? []).filter((r) => pageFilter === "all" || r.page === pageFilter);

  return (
    <>
      {error && (
        <div className="panel" style={{ borderColor: "var(--red)" }}>
          <p className="hint" style={{ color: "var(--redGlow)" }}>{error}</p>
        </div>
      )}

      <div className="panel">
        <div className="field" style={{ marginBottom: 0, maxWidth: 260 }}>
          <label>Filter by page</label>
          <select value={pageFilter} onChange={(e) => setPageFilter(e.target.value as typeof pageFilter)}>
            <option value="all">All pages</option>
            {PAGES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel">
        {rows === null && <p className="hint">Loading…</p>}
        {rows && visibleRows.length === 0 && <p className="hint">No content entries for this page yet.</p>}
        {visibleRows.map((row) => {
          const draft = drafts[row.id] ?? row.value ?? "";
          const dirty = drafts[row.id] !== undefined && drafts[row.id] !== row.value;
          return (
            <div key={row.id} style={{ padding: "14px 0", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{row.key}</span>{" "}
                  <span className="hint">
                    · {row.page} · {row.content_type}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {row.locked && <span className="badge locked">Locked</span>}
                </div>
              </div>
              {row.content_type === "carousel_slide" ? (
                <textarea
                  className="mono"
                  value={draft}
                  disabled={row.locked}
                  onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                  placeholder="JSON for this carousel slide"
                />
              ) : (
                <input
                  type={row.content_type === "color" ? "text" : "text"}
                  value={draft}
                  disabled={row.locked}
                  onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                  placeholder={row.content_type === "color" ? "#rrggbb" : row.content_type === "link" ? "https://…" : row.content_type === "image" ? "https://… (image URL)" : "Text value"}
                />
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                {!row.locked && (
                  <button className="btn btn-secondary" onClick={() => handleDelete(row)}>
                    Delete
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  disabled={row.locked || !dirty || savingId === row.id}
                  onClick={() => handleSave(row)}
                >
                  {savingId === row.id ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: 14 }}>Add content entry</div>
        <div className="field">
          <label>Key</label>
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g. hero_headline" />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Page</label>
            <select value={newPage} onChange={(e) => setNewPage(e.target.value as SiteContentRow["page"])}>
              {PAGES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Content type</label>
            <select value={newType} onChange={(e) => setNewType(e.target.value as SiteContentRow["content_type"])}>
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Value</label>
          {newType === "carousel_slide" ? (
            <textarea className="mono" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="JSON for this carousel slide" />
          ) : (
            <input value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          )}
        </div>
        <button className="btn btn-primary" disabled={!newKey.trim() || creating} onClick={handleCreate}>
          {creating ? "Adding…" : "Add Entry"}
        </button>
      </div>
    </>
  );
}

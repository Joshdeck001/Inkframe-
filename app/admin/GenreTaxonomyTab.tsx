"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Genre = {
  id: string;
  genre_name: string;
  parent_genre_id: string | null;
  platform: "kdp" | "goodnovel" | "meganovel" | "general";
  has_trope_addon: boolean;
  addon_content: Record<string, unknown> | null;
  last_verified: string | null;
  active: boolean;
};

const PLATFORMS: Genre["platform"][] = ["kdp", "goodnovel", "meganovel", "general"];

const BLANK_DRAFT = {
  genre_name: "",
  parent_genre_id: "",
  platform: "kdp" as Genre["platform"],
  has_trope_addon: false,
  addon_content: "{}",
  last_verified: "",
  active: true,
};

type Draft = typeof BLANK_DRAFT;

function toDraft(g: Genre): Draft {
  return {
    genre_name: g.genre_name,
    parent_genre_id: g.parent_genre_id ?? "",
    platform: g.platform,
    has_trope_addon: g.has_trope_addon,
    addon_content: JSON.stringify(g.addon_content ?? {}, null, 2),
    last_verified: g.last_verified ?? "",
    active: g.active,
  };
}

export default function GenreTaxonomyTab({ supabase }: { supabase: SupabaseClient }) {
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<"all" | Genre["platform"]>("all");

  async function load() {
    const { data, error: fetchError } = await supabase
      .from("genre_taxonomy")
      .select("*")
      .order("platform", { ascending: true })
      .order("genre_name", { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setGenres((data ?? []) as Genre[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await supabase
        .from("genre_taxonomy")
        .select("*")
        .order("platform", { ascending: true })
        .order("genre_name", { ascending: true });
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setGenres((data ?? []) as Genre[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function selectExisting(g: Genre) {
    setSelectedId(g.id);
    setDraft(toDraft(g));
    setError(null);
  }

  function selectNew() {
    setSelectedId("new");
    setDraft(BLANK_DRAFT);
    setError(null);
  }

  function parentName(id: string | null): string {
    if (!id) return "—";
    return genres?.find((g) => g.id === id)?.genre_name ?? "(unknown)";
  }

  async function handleSave() {
    setError(null);
    if (!draft.genre_name.trim()) {
      setError("Genre name is required.");
      return;
    }
    let addonContent: Record<string, unknown> | null = null;
    if (draft.has_trope_addon) {
      try {
        addonContent = draft.addon_content.trim() ? JSON.parse(draft.addon_content) : {};
      } catch {
        setError('"Trope addon content" isn\'t valid JSON.');
        return;
      }
    }
    const payload = {
      genre_name: draft.genre_name.trim(),
      parent_genre_id: draft.parent_genre_id || null,
      platform: draft.platform,
      has_trope_addon: draft.has_trope_addon,
      addon_content: addonContent,
      last_verified: draft.last_verified || null,
      active: draft.active,
    };
    setSaving(true);
    const result =
      selectedId === "new"
        ? await supabase.from("genre_taxonomy").insert(payload).select().single()
        : await supabase.from("genre_taxonomy").update(payload).eq("id", selectedId).select().single();
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    await load();
    setSelectedId(result.data.id);
    setDraft(toDraft(result.data as Genre));
  }

  const visible = (genres ?? []).filter((g) => platformFilter === "all" || g.platform === platformFilter);

  return (
    <>
      {error && (
        <div className="panel" style={{ borderColor: "var(--red)" }}>
          <p className="hint" style={{ color: "var(--redGlow)" }}>{error}</p>
        </div>
      )}

      <div className="panel">
        <div className="field" style={{ marginBottom: 0, maxWidth: 260 }}>
          <label>Filter by platform</label>
          <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as typeof platformFilter)}>
            <option value="all">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel">
        {genres === null && <p className="hint">Loading…</p>}
        {genres && visible.length === 0 && <p className="hint">No genres for this platform yet.</p>}
        {visible.map((g) => (
          <div key={g.id} className={`catalog-row${selectedId === g.id ? " selected" : ""}`} onClick={() => selectExisting(g)}>
            <span className={`status-dot ${g.active ? "ok" : "none"}`} />
            <div style={{ flex: 1 }}>
              <div className="bname">
                {g.genre_name} {g.has_trope_addon && <span className="badge admin" style={{ marginLeft: 6 }}>Trope Addon</span>}
              </div>
              <div className="bstatus">
                {g.platform}
                {g.parent_genre_id ? ` · under ${parentName(g.parent_genre_id)}` : ""}
                {!g.active ? " · inactive" : ""}
              </div>
            </div>
          </div>
        ))}
        <button className="btn btn-secondary" onClick={selectNew} style={{ marginTop: visible.length > 0 ? 6 : 0 }}>
          + Add Genre
        </button>
      </div>

      {selectedId && (
        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: 14 }}>{selectedId === "new" ? "New genre" : "Edit genre"}</div>
          <div className="field">
            <label>Genre name</label>
            <input value={draft.genre_name} onChange={(e) => setDraft((d) => ({ ...d, genre_name: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Platform</label>
              <select value={draft.platform} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value as Genre["platform"] }))}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Parent genre</label>
              <select value={draft.parent_genre_id} onChange={(e) => setDraft((d) => ({ ...d, parent_genre_id: e.target.value }))}>
                <option value="">None (top level)</option>
                {(genres ?? [])
                  .filter((g) => g.id !== selectedId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.genre_name} ({g.platform})
                    </option>
                  ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Last verified</label>
              <input type="date" value={draft.last_verified} onChange={(e) => setDraft((d) => ({ ...d, last_verified: e.target.value }))} />
            </div>
          </div>
          <div className="field-checkbox">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} />
            <label style={{ marginBottom: 0 }}>Active</label>
          </div>
          <div className="field-checkbox">
            <input
              type="checkbox"
              checked={draft.has_trope_addon}
              onChange={(e) => setDraft((d) => ({ ...d, has_trope_addon: e.target.checked }))}
            />
            <label style={{ marginBottom: 0 }}>Has trope add-on</label>
          </div>
          {draft.has_trope_addon && (
            <div className="field">
              <label>Trope add-on content (JSON)</label>
              <textarea className="mono" value={draft.addon_content} onChange={(e) => setDraft((d) => ({ ...d, addon_content: e.target.value }))} />
            </div>
          )}
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : selectedId === "new" ? "Create Genre" : "Save Changes"}
          </button>
        </div>
      )}
    </>
  );
}

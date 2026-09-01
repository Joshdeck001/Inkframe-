"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type PlatformProfile = {
  id: string;
  platform_name: string;
  profile_version: string;
  last_verified: string | null;
  supported_languages: string[];
  minimum_submission_words: number | null;
  preferred_genres: string[];
  submission_requirements: Record<string, unknown>;
  content_rules: Record<string, unknown>;
  metadata_rules: Record<string, unknown>;
  formatting_rules: Record<string, unknown>;
  image_rules: Record<string, unknown>;
  contract_submission_rules: Record<string, unknown>;
  source_references: string[];
  status: "active" | "needs_review" | "deprecated";
};

const JSON_FIELDS = [
  "submission_requirements",
  "content_rules",
  "metadata_rules",
  "formatting_rules",
  "image_rules",
  "contract_submission_rules",
] as const;

const BLANK_DRAFT = {
  platform_name: "",
  profile_version: "1.0",
  last_verified: "",
  supported_languages: "",
  minimum_submission_words: "",
  preferred_genres: "",
  source_references: "",
  status: "needs_review" as PlatformProfile["status"],
  submission_requirements: "{}",
  content_rules: "{}",
  metadata_rules: "{}",
  formatting_rules: "{}",
  image_rules: "{}",
  contract_submission_rules: "{}",
};

type Draft = typeof BLANK_DRAFT;

function toDraft(p: PlatformProfile): Draft {
  return {
    platform_name: p.platform_name,
    profile_version: p.profile_version,
    last_verified: p.last_verified ?? "",
    supported_languages: p.supported_languages.join(", "),
    minimum_submission_words: p.minimum_submission_words != null ? String(p.minimum_submission_words) : "",
    preferred_genres: p.preferred_genres.join(", "),
    source_references: p.source_references.join(", "),
    status: p.status,
    submission_requirements: JSON.stringify(p.submission_requirements, null, 2),
    content_rules: JSON.stringify(p.content_rules, null, 2),
    metadata_rules: JSON.stringify(p.metadata_rules, null, 2),
    formatting_rules: JSON.stringify(p.formatting_rules, null, 2),
    image_rules: JSON.stringify(p.image_rules, null, 2),
    contract_submission_rules: JSON.stringify(p.contract_submission_rules, null, 2),
  };
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function PlatformProfilesTab({ supabase }: { supabase: SupabaseClient }) {
  const [profiles, setProfiles] = useState<PlatformProfile[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data, error: fetchError } = await supabase
      .from("platform_profiles")
      .select("*")
      .order("platform_name", { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setProfiles((data ?? []) as PlatformProfile[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await supabase
        .from("platform_profiles")
        .select("*")
        .order("platform_name", { ascending: true });
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setProfiles((data ?? []) as PlatformProfile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function selectExisting(p: PlatformProfile) {
    setSelectedId(p.id);
    setDraft(toDraft(p));
    setError(null);
  }

  function selectNew() {
    setSelectedId("new");
    setDraft(BLANK_DRAFT);
    setError(null);
  }

  function buildPayload(): Record<string, unknown> | null {
    const parsedJson: Record<string, unknown> = {};
    for (const field of JSON_FIELDS) {
      try {
        parsedJson[field] = draft[field].trim() ? JSON.parse(draft[field]) : {};
      } catch {
        setError(`"${field.replace(/_/g, " ")}" isn't valid JSON.`);
        return null;
      }
    }
    if (!draft.platform_name.trim()) {
      setError("Platform name is required.");
      return null;
    }
    return {
      platform_name: draft.platform_name.trim(),
      profile_version: draft.profile_version.trim() || "1.0",
      last_verified: draft.last_verified || null,
      supported_languages: splitList(draft.supported_languages),
      minimum_submission_words: draft.minimum_submission_words ? Number(draft.minimum_submission_words) : null,
      preferred_genres: splitList(draft.preferred_genres),
      source_references: splitList(draft.source_references),
      status: draft.status,
      ...parsedJson,
    };
  }

  async function handleSave() {
    setError(null);
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    const result =
      selectedId === "new"
        ? await supabase.from("platform_profiles").insert(payload).select().single()
        : await supabase.from("platform_profiles").update(payload).eq("id", selectedId).select().single();
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    await load();
    setSelectedId(result.data.id);
    setDraft(toDraft(result.data as PlatformProfile));
  }

  return (
    <>
      {error && (
        <div className="panel" style={{ borderColor: "var(--red)" }}>
          <p className="hint" style={{ color: "var(--redGlow)" }}>{error}</p>
        </div>
      )}

      <div className="panel">
        {profiles === null && <p className="hint">Loading…</p>}
        {profiles?.map((p) => (
          <div key={p.id} className={`catalog-row${selectedId === p.id ? " selected" : ""}`} onClick={() => selectExisting(p)}>
            <span className={`status-dot ${p.status === "active" ? "ok" : p.status === "needs_review" ? "warn" : "none"}`} />
            <div style={{ flex: 1 }}>
              <div className="bname">{p.platform_name} · v{p.profile_version}</div>
              <div className="bstatus">{p.status.replace(/_/g, " ")}{p.last_verified ? ` · verified ${p.last_verified}` : ""}</div>
            </div>
          </div>
        ))}
        <button className="btn btn-secondary" onClick={selectNew} style={{ marginTop: profiles && profiles.length > 0 ? 6 : 0 }}>
          + Add Platform Profile
        </button>
      </div>

      {selectedId && (
        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: 14 }}>
            {selectedId === "new" ? "New platform profile" : "Edit platform profile"}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Platform name</label>
              <input value={draft.platform_name} onChange={(e) => setDraft((d) => ({ ...d, platform_name: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Profile version</label>
              <input value={draft.profile_version} onChange={(e) => setDraft((d) => ({ ...d, profile_version: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Status</label>
              <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as Draft["status"] }))}>
                <option value="active">active</option>
                <option value="needs_review">needs_review</option>
                <option value="deprecated">deprecated</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Last verified</label>
              <input type="date" value={draft.last_verified} onChange={(e) => setDraft((d) => ({ ...d, last_verified: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Minimum submission words</label>
              <input
                type="number"
                value={draft.minimum_submission_words}
                onChange={(e) => setDraft((d) => ({ ...d, minimum_submission_words: e.target.value }))}
              />
            </div>
          </div>
          <div className="field">
            <label>Supported languages (comma-separated)</label>
            <input value={draft.supported_languages} onChange={(e) => setDraft((d) => ({ ...d, supported_languages: e.target.value }))} />
          </div>
          <div className="field">
            <label>Preferred genres (comma-separated)</label>
            <input value={draft.preferred_genres} onChange={(e) => setDraft((d) => ({ ...d, preferred_genres: e.target.value }))} />
          </div>
          <div className="field">
            <label>Source references (comma-separated URLs/notes)</label>
            <input value={draft.source_references} onChange={(e) => setDraft((d) => ({ ...d, source_references: e.target.value }))} />
          </div>
          {JSON_FIELDS.map((field) => (
            <div className="field" key={field}>
              <label>{field.replace(/_/g, " ")} (JSON)</label>
              <textarea className="mono" value={draft[field]} onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))} />
            </div>
          ))}
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : selectedId === "new" ? "Create Profile" : "Save Changes"}
          </button>
        </div>
      )}
    </>
  );
}

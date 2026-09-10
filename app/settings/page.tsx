"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [preferredProvider, setPreferredProvider] = useState("auto");
  const [savingProvider, setSavingProvider] = useState(false);

  const [connections, setConnections] = useState<
    {
      id: string;
      name: string;
      created_at: string;
      last_used_at: string | null;
      status: string;
      paused: boolean;
      device_type: string | null;
      browser_name: string | null;
      browser_version: string | null;
      extension_version: string | null;
    }[] | null
  >(null);
  const [scoutDiagnostics, setScoutDiagnostics] = useState<{
    unassigned_clips: number;
    total_clips: number;
    last_extension_version: string | null;
    last_adapter_version: string | null;
    last_sync_at: string | null;
  } | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [deletingScoutData, setDeletingScoutData] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setUserId(user.id);
      setEmail(user.email ?? null);
      setFullName((user.user_metadata?.full_name as string | undefined) ?? "");
      setAvatarUrl((user.user_metadata?.avatar_url as string | undefined) ?? null);

      const { data: profile } = await supabase.from("profiles").select("preferred_ai_provider").eq("id", user.id).single();
      if (!cancelled && profile?.preferred_ai_provider) setPreferredProvider(profile.preferred_ai_provider);

      await loadConnections();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setUploadingAvatar(true);
    setError(null);
    setMessage(null);
    const ext = file.name.split(".").pop() || "png";
    const path = `${userId}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadError) {
      setUploadingAvatar(false);
      setError(uploadError.message);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${publicUrlData.publicUrl}?t=${Date.now()}`;
    const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: url } });
    setUploadingAvatar(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setAvatarUrl(url);
    setMessage("Profile picture updated.");
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ data: { full_name: fullName } });
    setSaving(false);
    if (error) setError(error.message);
    else setMessage("Name updated.");
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      setError(error.message);
    } else {
      setMessage("Password changed.");
      setNewPassword("");
      setConfirmPassword("");
    }
  }

  async function handleSaveProviderPreference(next: string) {
    setPreferredProvider(next);
    setSavingProvider(true);
    setError(null);
    setMessage(null);
    const { error } = await supabase.rpc("set_preferred_ai_provider", { new_provider: next });
    setSavingProvider(false);
    if (error) setError(error.message);
    else setMessage("AI model preference saved.");
  }

  async function loadConnections() {
    const { data } = await supabase
      .from("extension_connections")
      .select("id, name, created_at, last_used_at, status, paused, device_type, browser_name, browser_version, extension_version")
      .order("created_at", { ascending: false });
    setConnections(data ?? []);

    // Real diagnostics only — last-known version info comes from the most recent
    // clip this account actually produced, never a claim about what's installed now.
    const [{ count: unassigned }, { count: total }, { data: lastClip }] = await Promise.all([
      supabase.from("scout_clips").select("id", { count: "exact", head: true }).eq("status", "unassigned"),
      supabase.from("scout_clips").select("id", { count: "exact", head: true }),
      supabase.from("scout_clips").select("extension_version, adapter_version, clipped_at").order("clipped_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setScoutDiagnostics({
      unassigned_clips: unassigned ?? 0,
      total_clips: total ?? 0,
      last_extension_version: lastClip?.extension_version ?? null,
      last_adapter_version: lastClip?.adapter_version ?? null,
      last_sync_at: lastClip?.clipped_at ?? null,
    });
  }

  async function handleTogglePause(id: string, paused: boolean) {
    await supabase.from("extension_connections").update({ paused }).eq("id", id);
    await loadConnections();
  }

  async function handleDeleteScoutData() {
    if (
      !confirm(
        "Delete all InkframeScout data? This permanently removes every clip, snapshot, competition set, watchlist entry, and " +
          "opportunity you've collected. Evidence you already assigned into a research session is NOT affected — this only " +
          "deletes InkframeScout's own raw data. This can't be undone."
      )
    ) {
      return;
    }
    setDeletingScoutData(true);
    // RLS already scopes every one of these tables to the caller's own rows — .not("id", "is", null)
    // just satisfies the client's requirement for an explicit filter, it isn't the real safety boundary.
    await Promise.all([
      supabase.from("scout_clips").delete().not("id", "is", null),
      supabase.from("scout_snapshots").delete().not("id", "is", null),
      supabase.from("competition_sets").delete().not("id", "is", null),
      supabase.from("watched_books").delete().not("id", "is", null),
      supabase.from("scout_opportunities").delete().not("id", "is", null),
    ]);
    setDeletingScoutData(false);
    await loadConnections();
    setMessage("InkframeScout data deleted.");
  }

  async function handleGenerateCode() {
    setGeneratingCode(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/inkframescout/connect", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not generate a connection code.");
      setNewCode(json.code);
      setCodeCopied(false);
      await loadConnections();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate a connection code.");
    } finally {
      setGeneratingCode(false);
    }
  }

  function handleCopyCode() {
    if (!newCode) return;
    if (navigator.clipboard) navigator.clipboard.writeText(newCode);
    setCodeCopied(true);
  }

  async function handleRevokeConnection(id: string) {
    await supabase.from("extension_connections").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", id);
    await loadConnections();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth");
    router.refresh();
  }

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
        <h1>⚙ Settings</h1>
        <p className="subtitle">Your account.</p>

        {message && <p style={{ color: "#5fe3b8", fontSize: "13px", marginBottom: "14px" }}>{message}</p>}
        {error && <p style={{ color: "var(--red)", fontSize: "13px", marginBottom: "14px" }}>{error}</p>}

        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "14px" }}>Profile Picture</div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "14px" }}>
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "linear-gradient(135deg,var(--blueGlow),var(--red))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "20px",
                color: "#fff",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Profile picture" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                (fullName || email || "?")[0]?.toUpperCase()
              )}
            </div>
            <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
              {uploadingAvatar ? "Uploading…" : "Change Picture"}
              <input type="file" accept="image/*" onChange={handleAvatarChange} disabled={uploadingAvatar} style={{ display: "none" }} />
            </label>
          </div>
        </div>

        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "14px" }}>Profile</div>
          <form onSubmit={handleSaveName}>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email ?? ""} disabled />
            </div>
            <div className="field">
              <label>Name</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <button className="btn btn-secondary" type="submit" disabled={saving}>
              Save Name
            </button>
          </form>
        </div>

        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "14px" }}>Change Password</div>
          <form onSubmit={handleChangePassword}>
            <div className="field">
              <label>New Password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>Confirm New Password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <button className="btn btn-secondary" type="submit" disabled={saving}>
              Change Password
            </button>
          </form>
        </div>

        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "14px" }}>AI Model Preference</div>
          <div className="field">
            <label>Preferred provider</label>
            <select
              value={preferredProvider}
              onChange={(e) => handleSaveProviderPreference(e.target.value)}
              disabled={savingProvider}
            >
              <option value="auto">Auto (recommended) — Anthropic, then OpenAI, then Gemini</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </div>
          <p className="hint">
            Every AI task in InkFrame (writing, quality scoring, cover concepts, metadata, research, translation,
            advertising, the Copilot) tries your preferred provider first. If it fails or isn&apos;t configured
            with an API key, InkFrame automatically falls back to the others — this only changes which one goes
            first, it never removes the safety net.
          </p>
        </div>

        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "4px" }}>Extensions — InkframeScout</div>
          <p className="hint" style={{ marginBottom: "14px" }}>
            A real browser extension you install yourself. It never scans marketplace pages automatically —
            everything it captures is one deliberate click, on the page you&apos;re already looking at. Nothing
            is aggregated across other InkFrame accounts; what you capture stays yours until you choose to fold
            it into a research session. Supported today: Amazon, Google Play Books, Kobo (each only where a
            book&apos;s page is publicly visible — InkframeScout never logs into or bypasses any of them).
          </p>

          <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>Install</div>
          <p className="hint" style={{ marginBottom: "10px" }}>
            Not published to a web store yet — download it below, unzip it, then load it unpacked in your
            browser&apos;s extensions page.
          </p>
          <a
            className="btn btn-secondary"
            href="/downloads/inkframescout-extension.zip"
            download
            style={{ display: "inline-flex", marginBottom: "10px" }}
          >
            ⬇ Download InkframeScout Extension
          </a>
          <ol className="hint" style={{ marginBottom: "14px", paddingLeft: "18px", lineHeight: 1.7 }}>
            <li>Unzip the downloaded file — most browsers/OSes do this with one click on the download, or
              double-click the .zip afterward.</li>
            <li>Find the folder named <code>extension</code> inside it (it directly contains
              <code>manifest.json</code>) — that&apos;s the one you&apos;ll select next, even if it&apos;s
              nested inside another folder your unzip tool created.</li>
            <li>Open <code>chrome://extensions</code> (or your browser&apos;s equivalent) and turn on
              <b> Developer mode</b>.</li>
            <li>Click <b>Load unpacked</b> and select that <code>extension</code> folder.</li>
          </ol>

          <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>Connections</div>
          {connections === null && <p className="hint">Loading…</p>}
          {connections?.length === 0 && !newCode && <p className="hint" style={{ marginBottom: "12px" }}>No connections yet — generate a code below and paste it into the extension&apos;s popup.</p>}
          {connections?.map((c) => (
            <div className="field" key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px" }}>
                {c.name} —{" "}
                <span style={{ color: c.status !== "active" ? "var(--muted)" : c.paused ? "#ffc266" : "#5fe3b8" }}>
                  {c.status === "active" ? (c.paused ? "PAUSED" : "CONNECTED") : "REVOKED"}
                </span>
                <br />
                <span className="hint">
                  Created {new Date(c.created_at).toLocaleDateString()}
                  {c.last_used_at ? ` · Last used ${new Date(c.last_used_at).toLocaleString()}` : " · Never used"}
                </span>
                {(c.device_type || c.browser_name || c.extension_version) && (
                  <>
                    <br />
                    <span className="hint">
                      {c.device_type ? (c.device_type === "mobile" ? "📱 Mobile" : "🖥 Desktop") : "Device unknown"}
                      {c.browser_name ? ` · ${c.browser_name}${c.browser_version ? ` ${c.browser_version}` : ""}` : ""}
                      {c.extension_version ? ` · Extension v${c.extension_version}` : ""}
                    </span>
                  </>
                )}
              </span>
              {c.status === "active" && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn btn-secondary" onClick={() => handleTogglePause(c.id, !c.paused)}>
                    {c.paused ? "Resume" : "Pause"}
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleRevokeConnection(c.id)}>
                    Revoke
                  </button>
                </div>
              )}
            </div>
          ))}

          {scoutDiagnostics && connections && connections.length > 0 && (
            <div style={{ marginTop: "14px", padding: "12px", background: "rgba(255,255,255,.03)", border: "1px solid var(--border, #1c2740)", borderRadius: "10px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>Diagnostics</div>
              <p className="hint">Total clips: {scoutDiagnostics.total_clips} · Awaiting review: {scoutDiagnostics.unassigned_clips}</p>
              <p className="hint">
                Last sync: {scoutDiagnostics.last_sync_at ? new Date(scoutDiagnostics.last_sync_at).toLocaleString() : "Never"}
              </p>
              <p className="hint">
                Last known extension version: {scoutDiagnostics.last_extension_version ?? "Unknown"} · adapter: {scoutDiagnostics.last_adapter_version ?? "Unknown"}
              </p>
              <button className="btn btn-secondary" style={{ marginTop: "10px" }} onClick={handleDeleteScoutData} disabled={deletingScoutData}>
                {deletingScoutData ? "Deleting…" : "Delete All InkframeScout Data"}
              </button>
            </div>
          )}

          <button className="btn btn-secondary" onClick={handleGenerateCode} disabled={generatingCode} style={{ marginTop: "6px" }}>
            {generatingCode ? "Generating…" : "Generate Connection Code"}
          </button>

          {newCode && (
            <div style={{ marginTop: "14px", background: "rgba(76,139,255,.08)", border: "1px solid rgba(76,139,255,.25)", borderRadius: "10px", padding: "14px" }}>
              <p className="hint" style={{ marginBottom: "8px" }}>
                Paste this into the InkframeScout extension&apos;s popup. It&apos;s shown only once — copy it now.
              </p>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <code style={{ fontSize: "12px", wordBreak: "break-all", flex: 1 }}>{newCode}</code>
                <button className="btn btn-secondary" onClick={handleCopyCode}>
                  {codeCopied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div style={{ fontWeight: 700, marginBottom: "10px" }}>Sign out</div>
          <button className="btn btn-primary" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}

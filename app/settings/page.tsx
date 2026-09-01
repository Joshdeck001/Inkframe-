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
          <div style={{ fontWeight: 700, marginBottom: "10px" }}>Sign out</div>
          <button className="btn btn-primary" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}

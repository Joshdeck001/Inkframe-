"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css } from "@/content/auth";

export const dynamic = "force-dynamic";

function passwordIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push("at least 8 characters");
  if (!/[a-z]/.test(pw)) issues.push("a lowercase letter");
  if (!/[A-Z]/.test(pw)) issues.push("an uppercase letter");
  if (!/[0-9]/.test(pw)) issues.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push("a symbol");
  return issues;
}

// Reached only from the link in the password-reset email (see
// handleForgotPassword in app/auth/page.tsx) — Supabase's browser client
// auto-detects the recovery token in the URL and establishes a temporary
// session that's only valid for setting a new password, which is why this
// checks for a real session before showing the form rather than assuming
// one exists just because the link was clicked.
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = "InkFrame — Reset Password";
  }, []);

  useEffect(() => {
    let cancelled = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasSession(true);
        setChecking(false);
      }
    });
    // Covers the case where the recovery session was already established by
    // the time this effect runs (the auth-state event can fire before the
    // listener above is attached).
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setHasSession(true);
      setChecking(false);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    const issues = passwordIssues(password);
    if (issues.length > 0) {
      setError("Password needs " + issues.join(", ") + ".");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="card blue-edge active" id="reset-card">
        <div className="brand">
          <img src="/logo-brand.png" alt="InkFrame" />
        </div>
        <h1>Set a New Password</h1>

        {checking && <p className="subtitle">Checking your reset link…</p>}

        {!checking && !hasSession && !done && (
          <>
            <p className="subtitle">
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <button className="btn" onClick={() => router.push("/auth")}>
              Back to Sign In
            </button>
          </>
        )}

        {!checking && hasSession && !done && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>New Password</label>
              <span className="ic">🔒</span>
              <span className="eye" onClick={() => setShowPw((v) => !v)} style={{ cursor: "pointer" }}>
                {showPw ? "🙈" : "👁"}
              </span>
              <input
                type={showPw ? "text" : "password"}
                placeholder="Create a new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Confirm New Password</label>
              <span className="ic">🔒</span>
              <input
                type={showPw ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <p style={{ color: "var(--red)", fontSize: "12.5px", marginBottom: "14px" }}>{error}</p>
            )}

            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Saving…" : "Set New Password"}
            </button>
          </form>
        )}

        {done && (
          <>
            <p className="subtitle">Your password has been updated.</p>
            <button className="btn" onClick={() => router.push("/dashboard")}>
              Continue to Dashboard
            </button>
          </>
        )}
      </div>
    </>
  );
}

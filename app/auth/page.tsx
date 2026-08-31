"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title } from "@/content/auth";

type Mode = "signin" | "signup";

function passwordIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push("at least 8 characters");
  if (!/[a-z]/.test(pw)) issues.push("a lowercase letter");
  if (!/[A-Z]/.test(pw)) issues.push("an uppercase letter");
  if (!/[0-9]/.test(pw)) issues.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push("a symbol");
  return issues;
}

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");

  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    document.title = title;
  }, []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: signinEmail,
      password: signinPassword,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (signupPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    const issues = passwordIssues(signupPassword);
    if (issues.length > 0) {
      setError("Password needs " + issues.join(", ") + ".");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data.session) {
      router.push(next);
      router.refresh();
    } else {
      setCheckEmail(true);
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {mode === "signin" && (
        <div className="card blue-edge active" id="signin-card">
          <div className="brand">
            <img src="/logo-brand.png" alt="InkFrame" />
          </div>
          <h1>Welcome Back</h1>
          <p className="subtitle">Sign in to your InkFrame account and continue creating.</p>

          <form onSubmit={handleSignIn}>
            <div className="field">
              <label>Email Address</label>
              <span className="ic">👤</span>
              <input
                type="email"
                placeholder="Enter your email"
                value={signinEmail}
                onChange={(e) => setSigninEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Password</label>
              <span className="ic">🔒</span>
              <span className="eye" onClick={() => setShowPw((v) => !v)} style={{ cursor: "pointer" }}>
                {showPw ? "🙈" : "👁"}
              </span>
              <input
                type={showPw ? "text" : "password"}
                placeholder="Enter your password"
                value={signinPassword}
                onChange={(e) => setSigninPassword(e.target.value)}
                required
              />
            </div>

            <div className="row-between">
              <div className="remember">
                <span className="checkbox">✓</span> Remember me
              </div>
              <a className="link" href="#">
                Forgot Password?
              </a>
            </div>

            {error && (
              <p style={{ color: "var(--red)", fontSize: "12.5px", marginBottom: "14px" }}>{error}</p>
            )}

            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Continue"}
            </button>
          </form>

          <div className="divider">
            <span className="line"></span>OR<span className="line"></span>
          </div>
          <div className="switch">
            Don&apos;t have an account?{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setError(null);
                setMode("signup");
              }}
            >
              Sign up
            </a>
          </div>
        </div>
      )}

      {mode === "signup" && (
        <div className="card red-edge active" id="signup-card">
          <div className="brand">
            <img src="/logo-brand.png" alt="InkFrame" />
          </div>
          <h1>Create Your Account</h1>
          <p className="subtitle">Join InkFrame and start writing, formatting, and publishing today.</p>

          {checkEmail ? (
            <p className="subtitle" style={{ marginTop: "8px" }}>
              Check <strong>{signupEmail}</strong> for a confirmation link to finish creating your account.
            </p>
          ) : (
            <form onSubmit={handleSignUp}>
              <div className="row-2">
                <div className="field">
                  <label>Full Name</label>
                  <span className="ic">👤</span>
                  <input
                    type="text"
                    placeholder="Full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Email Address</label>
                  <span className="ic">✉</span>
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="row-2">
                <div className="field">
                  <label>Password</label>
                  <span className="ic">🔒</span>
                  <span
                    className="eye"
                    onClick={() => setShowPw((v) => !v)}
                    style={{ cursor: "pointer" }}
                  >
                    {showPw ? "🙈" : "👁"}
                  </span>
                  <input
                    type={showPw ? "text" : "password"}
                    placeholder="Create password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Confirm Password</label>
                  <span className="ic">🔒</span>
                  <span
                    className="eye"
                    onClick={() => setShowPw2((v) => !v)}
                    style={{ cursor: "pointer" }}
                  >
                    {showPw2 ? "🙈" : "👁"}
                  </span>
                  <input
                    type={showPw2 ? "text" : "password"}
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="checklist">
                <span className="checkbox">✓</span> Password must be at least 8 characters
              </div>
              <div className="checklist">
                <span className="checkbox">✓</span> Include uppercase, lowercase, number &amp; symbol
              </div>
              <div className="checklist">
                <span className="checkbox">✓</span> I agree to the{" "}
                <a className="link" href="#">
                  &nbsp;Terms of Service&nbsp;
                </a>{" "}
                and{" "}
                <a className="link" href="#">
                  &nbsp;Privacy Policy
                </a>
              </div>

              {error && (
                <p style={{ color: "var(--red)", fontSize: "12.5px", marginBottom: "8px" }}>{error}</p>
              )}

              <button className="btn" style={{ marginTop: "14px" }} type="submit" disabled={loading}>
                {loading ? "Creating account…" : "Continue"}
              </button>
            </form>
          )}

          <div className="divider">
            <span className="line"></span>OR<span className="line"></span>
          </div>
          <div className="switch">
            Already have an account?{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setError(null);
                setCheckEmail(false);
                setMode("signin");
              }}
            >
              Sign in
            </a>
          </div>
        </div>
      )}
    </>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm />
    </Suspense>
  );
}

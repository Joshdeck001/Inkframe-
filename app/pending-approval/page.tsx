"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";

export const dynamic = "force-dynamic";

export default function PendingApprovalPage() {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<"checking" | "pending" | "rejected" | "signed_out">("checking");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setStatus("signed_out");
        return;
      }
      const { data: profile } = await supabase.from("profiles").select("approval_status").eq("id", user.id).single();
      if (cancelled) return;
      setStatus(profile?.approval_status === "rejected" ? "rejected" : "pending");
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleCheckAgain() {
    setChecking(true);
    router.push("/dashboard");
    router.refresh();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth");
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sharedSecondaryCss }} />
      <header>
        <div className="logo">
          <span className="ink">Ink</span>
          <span className="frame">Frame</span>
        </div>
      </header>
      <div className="wrap">
        {status === "checking" && (
          <div className="panel">
            <p className="hint">Checking your account…</p>
          </div>
        )}

        {status === "signed_out" && (
          <div className="empty-panel">
            <div className="ei">🔒</div>
            <h3>Sign in required</h3>
            <p>Sign in to check your account status.</p>
            <button className="btn btn-primary" onClick={() => router.push("/auth")}>
              Go to Sign In
            </button>
          </div>
        )}

        {status === "pending" && (
          <div className="empty-panel">
            <div className="ei">⏳</div>
            <h3>Your account is awaiting approval</h3>
            <p>
              An admin needs to approve new accounts before they can use InkFrame. This is usually quick — check
              back in a bit, or contact whoever set up your access.
            </p>
            <button className="btn btn-primary" onClick={handleCheckAgain} disabled={checking}>
              {checking ? "Checking…" : "Check Again"}
            </button>
            <button className="btn btn-secondary" onClick={handleSignOut} style={{ marginLeft: 10 }}>
              Sign Out
            </button>
          </div>
        )}

        {status === "rejected" && (
          <div className="empty-panel">
            <div className="ei">🚫</div>
            <h3>This account wasn&apos;t approved</h3>
            <p>Contact whoever set up your access if you think this is a mistake.</p>
            <button className="btn btn-secondary" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import SiteContentTab from "./SiteContentTab";
import PlatformProfilesTab from "./PlatformProfilesTab";
import GenreTaxonomyTab from "./GenreTaxonomyTab";
import UsersTab from "./UsersTab";
import MessagesTab from "./MessagesTab";

export const dynamic = "force-dynamic";

type Tab = "content" | "platforms" | "genres" | "users" | "messages";

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<"checking" | "denied" | "signed_out" | "admin">("checking");
  const [tab, setTab] = useState<Tab>("content");

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
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (cancelled) return;
      setStatus(profile?.role === "admin" ? "admin" : "denied");
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
        <h1>⚙ Admin Panel</h1>
        <p className="subtitle">Admin-only tools for managing InkFrame.</p>

        {status === "checking" && (
          <div className="panel">
            <p className="hint">Checking access…</p>
          </div>
        )}

        {status === "signed_out" && (
          <div className="empty-panel">
            <div className="ei">🔒</div>
            <h3>Sign in required</h3>
            <p>You need to sign in to view the Admin Panel.</p>
            <button className="btn btn-primary" onClick={() => router.push("/auth")}>
              Go to Sign In
            </button>
          </div>
        )}

        {status === "denied" && (
          <div className="empty-panel">
            <div className="ei">🔒</div>
            <h3>Admins only</h3>
            <p>Your account doesn&apos;t have admin access. Ask an existing admin to promote you from the Supabase dashboard.</p>
            <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>
              Back to Dashboard
            </button>
          </div>
        )}

        {status === "admin" && (
          <>
            <div className="tabs">
              <button className={`tab-btn${tab === "content" ? " active" : ""}`} onClick={() => setTab("content")}>
                Site Content
              </button>
              <button className={`tab-btn${tab === "platforms" ? " active" : ""}`} onClick={() => setTab("platforms")}>
                Platform Profiles
              </button>
              <button className={`tab-btn${tab === "genres" ? " active" : ""}`} onClick={() => setTab("genres")}>
                Genre Taxonomy
              </button>
              <button className={`tab-btn${tab === "users" ? " active" : ""}`} onClick={() => setTab("users")}>
                Users
              </button>
              <button className={`tab-btn${tab === "messages" ? " active" : ""}`} onClick={() => setTab("messages")}>
                Messages
              </button>
            </div>

            {tab === "content" && <SiteContentTab supabase={supabase} />}
            {tab === "platforms" && <PlatformProfilesTab supabase={supabase} />}
            {tab === "genres" && <GenreTaxonomyTab supabase={supabase} />}
            {tab === "users" && <UsersTab />}
            {tab === "messages" && <MessagesTab />}
          </>
        )}
      </div>
    </>
  );
}

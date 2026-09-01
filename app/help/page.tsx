"use client";

import { useRouter } from "next/navigation";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";

export default function HelpPage() {
  const router = useRouter();

  const faqs = [
    {
      q: "How does the AI Writing Agent work?",
      a: "Once you approve a Book Blueprint in the New Book wizard, InkFrame writes your manuscript chapter by chapter in the background. You can close the tab — it keeps working — and check progress any time from the Writing Agent page.",
    },
    {
      q: "Will InkFrame publish my book for me?",
      a: "No — never. InkFrame prepares everything (metadata, cover concepts, a formatted manuscript) and hands it to you to review. You always do the actual upload yourself, on your own login, on whichever platform you choose.",
    },
    {
      q: "Does InkFrame guarantee my book will be accepted by Amazon KDP or another platform?",
      a: "No. Quality checks and readiness scores are internal assessments to help you gauge manuscript strength — never a guarantee of platform acceptance.",
    },
    {
      q: "My book is AI-generated — do I need to disclose that?",
      a: "Most platforms, including Amazon KDP, require disclosure for AI-generated content. InkFrame flags this automatically in your Compliance Check for every project.",
    },
    {
      q: "How often does the background work happen?",
      a: "It depends on your hosting plan's settings — check with whoever manages your InkFrame deployment if progress seems slower than expected.",
    },
  ];

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
        <h1>? Help &amp; Support</h1>
        <p className="subtitle">Common questions.</p>

        {faqs.map((f, i) => (
          <div className="panel" key={i}>
            <div style={{ fontWeight: 700, marginBottom: "8px" }}>{f.q}</div>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>{f.a}</p>
          </div>
        ))}
      </div>
    </>
  );
}

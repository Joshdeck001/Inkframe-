"use client";

import { useRouter } from "next/navigation";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";

export default function ImagesPage() {
  const router = useRouter();

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
        <h1>🖼 Images</h1>
        <div className="empty-panel">
          <div className="ei">🚧</div>
          <h3>Not built yet</h3>
          <p>
            In-manuscript image generation and placement isn&apos;t implemented — the wizard collects your
            preference for it (Step 7), but nothing generates images yet. Cover concept prompts (a related but
            separate feature) are real — see Cover Designer.
          </p>
          <button className="btn btn-primary" onClick={() => router.push("/cover")}>
            Go to Cover Designer
          </button>
        </div>
      </div>
    </>
  );
}

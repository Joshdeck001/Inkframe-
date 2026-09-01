"use client";

import { useRouter } from "next/navigation";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";

export default function TemplatesPage() {
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
        <h1>▧ Templates</h1>
        <div className="empty-panel">
          <div className="ei">🚧</div>
          <h3>Not built yet</h3>
          <p>Saved house-style/manuscript templates aren&apos;t implemented yet — this is a placeholder rather than a feature with nothing behind it.</p>
          <button className="btn btn-primary" onClick={() => router.push("/wizard")}>
            ＋ Start a New Book Instead
          </button>
        </div>
      </div>
    </>
  );
}

"use client";

import { useEffect } from "react";

/**
 * Renders one of the original static HTML pages (exact markup/CSS) as a Next.js
 * route while preserving its original vanilla-JS behavior. Used for pages that
 * don't yet need real backend wiring — interactive pages get ported to proper
 * React components instead as each one is wired up.
 */
export default function LegacyPage({
  title,
  css,
  bodyHtml,
  script,
}: {
  title: string;
  css: string;
  bodyHtml: string;
  script?: string;
}) {
  useEffect(() => {
    document.title = title;
    if (!script) return;
    const el = document.createElement("script");
    el.textContent = script;
    document.body.appendChild(el);
    return () => {
      document.body.removeChild(el);
    };
  }, [title, script]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </>
  );
}

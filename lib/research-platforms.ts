/**
 * Real, evidence-gated cross-platform intelligence (spec sections 19/49:
 * "Only show platform-specific conclusions when the system has actual
 * evidence for them" / "Never manufacture a score just to fill the
 * table"). This never calls a platform-specific API (none exist for
 * Amazon/Kobo research — see README) — it only tallies which evidence
 * rows the author or the extraction stage already tagged with a
 * platform, via competitor_research.platform / keyword_research.platform.
 * A platform with zero tagged rows reports hasEvidence: false and the
 * report generator is instructed to say "insufficient evidence" for it
 * rather than guess.
 */

export type Platform = "amazon" | "google_play" | "kobo";
export const PLATFORMS: Platform[] = ["amazon", "google_play", "kobo"];

export type PlatformBreakdown = {
  platform: Platform;
  competitorCount: number;
  keywordCount: number;
  keywordsWithDemandSignal: number;
  hasEvidence: boolean;
};

export function normalizePlatform(raw: string | null | undefined): Platform | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("amazon") || s.includes("kdp")) return "amazon";
  if (s.includes("google") || s.includes("play")) return "google_play";
  if (s.includes("kobo")) return "kobo";
  return null;
}

export function computePlatformBreakdown(
  competitors: { platform: string | null }[],
  keywords: { platform: string | null; demand_signal: string | null }[]
): PlatformBreakdown[] {
  return PLATFORMS.map((platform) => {
    const comp = competitors.filter((c) => normalizePlatform(c.platform) === platform);
    const kw = keywords.filter((k) => normalizePlatform(k.platform) === platform);
    return {
      platform,
      competitorCount: comp.length,
      keywordCount: kw.length,
      keywordsWithDemandSignal: kw.filter((k) => !!k.demand_signal).length,
      hasEvidence: comp.length > 0 || kw.length > 0,
    };
  });
}

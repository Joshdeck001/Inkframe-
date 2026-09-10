import { buildObservedSeries, type MatchableClip } from "@/lib/scout-matching";
import { wordFrequency, clusterKeywords } from "@/lib/research-frequency";

/**
 * Opportunity Radar (spec section 9) for a Competition Set — deliberately
 * built with the same discipline as lib/research-opportunity.ts: every
 * dimension is a capped function of a REAL count already sitting in
 * scout_clips, with a `basis` string citing exactly what produced it.
 * "Demand" and "Discoverability" are NOT included — InkFrame has no real
 * search-volume/impression data to back either one, and inventing a
 * plausible-looking number for them would be exactly the fabrication the
 * standing rule forbids. A dimension this app genuinely can't compute is
 * marked `insufficient_data`, never guessed.
 */

export type RadarDimension = {
  label: string;
  score: number | null;
  confidence: "low" | "medium" | "high" | "insufficient_data";
  basis: string;
};

export type OpportunityRadar = {
  overall: number | null;
  confidence: "low" | "medium" | "high" | "insufficient_data";
  calculationVersion: number;
  dimensions: RadarDimension[];
  disclaimer: string;
};

export const OPPORTUNITY_RADAR_CALCULATION_VERSION = 1;

export function computeOpportunityRadar(clips: MatchableClip[]): OpportunityRadar {
  const disclaimer =
    "Decision support, not a sales prediction. Every dimension below is computed only from books you've " +
    "clipped into this competition set — never an estimate of demand, search volume, or units sold.";

  if (clips.length === 0) {
    return {
      overall: null,
      confidence: "insufficient_data",
      calculationVersion: OPPORTUNITY_RADAR_CALCULATION_VERSION,
      dimensions: [],
      disclaimer,
    };
  }

  const dimensions: RadarDimension[] = [];

  dimensions.push({
    label: "Competition density",
    score: Math.min(100, clips.length * 10),
    confidence: "high",
    basis: `${clips.length} book(s) recorded in this competition set — higher means more crowded, not necessarily worse.`,
  });

  const marketplaces = new Set(clips.map((c) => c.marketplace));
  dimensions.push({
    label: "Cross-platform reach",
    score: Math.round((marketplaces.size / 3) * 100),
    confidence: "high",
    basis: `Present on ${marketplaces.size} of 3 supported marketplaces (${[...marketplaces].join(", ")}).`,
  });

  const prices = clips.map((c) => c.price).filter((p): p is number => p != null);
  if (prices.length >= 2) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const spreadPct = avg > 0 ? Math.min(100, Math.round(((max - min) / avg) * 100)) : 0;
    dimensions.push({
      label: "Price spread",
      score: spreadPct,
      confidence: "medium",
      basis: `Observed prices range from $${min.toFixed(2)} to $${max.toFixed(2)} (avg $${avg.toFixed(2)}) across ${prices.length} book(s) with a recorded price.`,
    });
  } else {
    dimensions.push({ label: "Price spread", score: null, confidence: "insufficient_data", basis: "Fewer than 2 books in this set have a recorded price." });
  }

  const bsrSeries = buildObservedSeries(clips, "bsr");
  if (bsrSeries.length > 0) {
    const improving = bsrSeries.filter((s) => s.direction === "down").length; // lower BSR number = better rank
    const momentumScore = Math.round((improving / bsrSeries.length) * 100);
    dimensions.push({
      label: "Momentum",
      score: momentumScore,
      confidence: bsrSeries.length >= 3 ? "medium" : "low",
      basis: `${improving} of ${bsrSeries.length} re-observed listing(s) showed an improving (lower) BSR between your first and most recent clip.`,
    });
  } else {
    dimensions.push({
      label: "Momentum",
      score: null,
      confidence: "insufficient_data",
      basis: "No book in this set has been clipped more than once yet — momentum needs at least two observations of the same listing over time.",
    });
  }

  const titles = clips.map((c) => c.title).filter((t): t is string => !!t);
  const clusters = clusterKeywords(wordFrequency(titles, 15).map((f) => f.term));
  dimensions.push({
    label: "Positioning variety",
    score: Math.min(100, clusters.length * 20),
    confidence: titles.length >= 3 ? "medium" : "low",
    basis: `${clusters.length} distinct title-keyword cluster(s) found across ${titles.length} book(s) — more clusters suggests more varied positioning, not a gap by itself.`,
  });

  const scored = dimensions.filter((d): d is RadarDimension & { score: number } => d.score != null);
  const overall = scored.length > 0 ? Math.round(scored.reduce((s, d) => s + d.score, 0) / scored.length) : null;
  const confidence: OpportunityRadar["confidence"] = clips.length >= 5 ? "medium" : clips.length >= 2 ? "low" : "insufficient_data";

  return { overall, confidence, calculationVersion: OPPORTUNITY_RADAR_CALCULATION_VERSION, dimensions, disclaimer };
}

export type MarketScanResult = {
  booksAnalyzed: number;
  observedCategories: number;
  topClusters: { label: string; keywords: string[]; matchingBooks: number }[];
  priceRange: { min: number; max: number; avg: number } | null;
  disclaimer: string;
};

/**
 * Research's Market Scanner (spec section 36) — reuses the exact same
 * frequency/clustering tooling the Research Department already uses
 * (lib/research-frequency.ts), applied to a set of already-clipped books
 * instead of live-scanning a marketplace page. "Books analyzed" is always
 * the real count of clips passed in, never a claim about the whole market.
 */
export function scanMarket(clips: { title: string | null; category: string | null; price: number | null }[]): MarketScanResult {
  const titles = clips.map((c) => c.title).filter((t): t is string => !!t);
  const categories = new Set(clips.map((c) => c.category).filter((c): c is string => !!c));
  const freq = wordFrequency(titles, 15);
  const clusters = clusterKeywords(freq.map((f) => f.term)).slice(0, 8);
  const topClusters = clusters.map((cl) => ({
    label: cl.label,
    keywords: cl.keywords,
    matchingBooks: titles.filter((t) => cl.keywords.some((k) => t.toLowerCase().includes(k))).length,
  }));
  const prices = clips.map((c) => c.price).filter((p): p is number => p != null);
  const priceRange =
    prices.length > 0
      ? { min: Math.min(...prices), max: Math.max(...prices), avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 }
      : null;

  return {
    booksAnalyzed: clips.length,
    observedCategories: categories.size,
    topClusters,
    priceRange,
    disclaimer: "Computed only from books you've clipped so far — a sample you collected, not a full market census.",
  };
}

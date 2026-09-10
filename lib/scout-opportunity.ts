import { buildObservedSeries, type MatchableClip } from "@/lib/scout-matching";
import { wordFrequency, clusterKeywords } from "@/lib/research-frequency";

/**
 * Opportunity Signals (v3 spec sections 9/10) — replaces v2's numeric
 * "Opportunity Score = 87" with explainable qualitative signals, exactly
 * because a single composite number implies a precision none of this
 * evidence supports. Every signal is a deterministic function of a REAL
 * count already sitting in scout_clips, cites its `evidence`, explains
 * its `reasoning` in careful (never causal, never exhaustive) language,
 * and carries its own `confidence` — never a mysterious black box.
 *
 * "Demand Signal" is always INSUFFICIENT_EVIDENCE: InkFrame has no real
 * search-volume/impression data source, so rather than omit the concept
 * entirely (as v2 did) or fabricate a number, v3 shows it explicitly
 * marked unavailable — the spec's own "unavailable, not invented" rule.
 */

export type SignalStatus = "STRONG" | "MODERATE" | "WEAK" | "UNCLEAR" | "INSUFFICIENT_EVIDENCE";
export type OpportunitySignal = {
  label: string;
  status: SignalStatus;
  evidence: string;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  timestamp: string;
};

export type MarketSample = {
  booksAnalyzed: number;
  marketplaces: string[];
  earliestCapture: string | null;
  latestCapture: string | null;
};

export type OpportunitySignals = {
  signals: OpportunitySignal[];
  sample: MarketSample;
  calculationVersion: number;
  disclaimer: string;
};

export const OPPORTUNITY_SIGNALS_CALCULATION_VERSION = 2;

function signal(label: string, status: SignalStatus, evidence: string, reasoning: string, confidence: OpportunitySignal["confidence"]): OpportunitySignal {
  return { label, status, evidence, reasoning, confidence, timestamp: new Date().toISOString() };
}

function competitionSignal(clips: MatchableClip[]): OpportunitySignal {
  const n = clips.length;
  if (n < 2) return signal("Competition Signal", "INSUFFICIENT_EVIDENCE", `${n} book(s) captured.`, "Capture at least two comparable books to assess competition within this sample.", "low");
  const status: SignalStatus = n >= 10 ? "STRONG" : n >= 5 ? "MODERATE" : "WEAK";
  const reasoning =
    status === "STRONG"
      ? "A relatively large number of comparable books were captured — this suggests an active, closely-watched topic within the captured sample, not necessarily a worse opportunity."
      : status === "MODERATE"
        ? "A moderate number of comparable books were captured within this sample."
        : "Few comparable books were captured — this may mean less competition, or simply that fewer have been clipped yet. It is not a live market census.";
  return signal("Competition Signal", status, `${n} book(s) captured in this competition set.`, reasoning, n >= 5 ? "medium" : "low");
}

function crossPlatformSignal(clips: MatchableClip[], marketplaces: string[]): OpportunitySignal {
  if (clips.length === 0) return signal("Cross-Platform Signal", "INSUFFICIENT_EVIDENCE", "No books captured.", "Capture books to see cross-platform presence.", "low");
  const status: SignalStatus = marketplaces.length >= 3 ? "STRONG" : marketplaces.length === 2 ? "MODERATE" : "WEAK";
  const reasoning =
    marketplaces.length >= 2
      ? "Comparable books were captured across more than one marketplace, suggesting broader distribution within the sample."
      : "All captured books so far come from a single marketplace — capture from others to see a fuller cross-platform picture.";
  return signal("Cross-Platform Signal", status, `Present on ${marketplaces.length} of 3 supported marketplaces (${marketplaces.join(", ") || "none"}).`, reasoning, "high");
}

function pricePositioningSignal(clips: MatchableClip[]): OpportunitySignal {
  const prices = clips.map((c) => c.price).filter((p): p is number => p != null);
  if (prices.length < 2) return signal("Price Positioning Signal", "INSUFFICIENT_EVIDENCE", `${prices.length} book(s) with a recorded price.`, "Fewer than 2 captured books have a recorded price.", "low");
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const spreadPct = avg > 0 ? ((max - min) / avg) * 100 : 0;
  const status: SignalStatus = spreadPct > 40 ? "STRONG" : spreadPct >= 10 ? "MODERATE" : "UNCLEAR";
  const reasoning =
    status === "STRONG"
      ? "A wide observed price range suggests room for a different price position within this sample."
      : status === "MODERATE"
        ? "A moderate observed price range exists within this sample."
        : "Observed prices are tightly clustered — limited room to differentiate on price alone within this sample.";
  return signal(
    "Price Positioning Signal",
    status,
    `Observed prices range from $${min.toFixed(2)} to $${max.toFixed(2)} (avg $${avg.toFixed(2)}) across ${prices.length} book(s).`,
    reasoning,
    "medium"
  );
}

function marketMomentumSignal(clips: MatchableClip[]): OpportunitySignal {
  const bsrSeries = buildObservedSeries(clips, "bsr");
  if (bsrSeries.length === 0) {
    return signal(
      "Market Momentum Signal",
      "INSUFFICIENT_EVIDENCE",
      "No book in this set has been captured more than once yet.",
      "Momentum needs at least two observations of the same listing over time — capture a book again later to start a trend.",
      "low"
    );
  }
  const improving = bsrSeries.filter((s) => s.direction === "down").length; // lower BSR number = better rank
  const ratio = improving / bsrSeries.length;
  const status: SignalStatus = ratio === 1 ? "STRONG" : ratio > 0.5 ? "MODERATE" : ratio === 0.5 ? "UNCLEAR" : "WEAK";
  const reasoning =
    ratio > 0.5
      ? "Rank improved between captured observations for most re-observed listings in this sample."
      : ratio < 0.5
        ? "Rank declined between captured observations for most re-observed listings in this sample."
        : "Re-observed listings were evenly split between improving and declining rank.";
  return signal(
    "Market Momentum Signal",
    status,
    `${improving} of ${bsrSeries.length} re-observed listing(s) showed an improving (lower) BSR between captured observations.`,
    reasoning,
    bsrSeries.length >= 3 ? "medium" : "low"
  );
}

function differentiationSignal(clips: MatchableClip[]): OpportunitySignal {
  const titles = clips.map((c) => c.title).filter((t): t is string => !!t);
  if (titles.length === 0) return signal("Differentiation Signal", "INSUFFICIENT_EVIDENCE", "No titled books captured.", "Capture books with a title to assess positioning variety.", "low");
  const clusters = clusterKeywords(wordFrequency(titles, 15).map((f) => f.term));
  const status: SignalStatus = clusters.length >= 4 ? "STRONG" : clusters.length >= 2 ? "MODERATE" : clusters.length === 1 ? "WEAK" : "INSUFFICIENT_EVIDENCE";
  const reasoning =
    clusters.length >= 2
      ? "Captured titles show multiple distinct positioning clusters within this sample, suggesting more than one existing approach — and potential room for a different one."
      : "Captured titles cluster tightly around very similar terms within this sample.";
  return signal("Differentiation Signal", status, `${clusters.length} distinct title-keyword cluster(s) found across ${titles.length} book(s).`, reasoning, titles.length >= 3 ? "medium" : "low");
}

function demandSignal(): OpportunitySignal {
  return signal(
    "Demand Signal",
    "INSUFFICIENT_EVIDENCE",
    "InkFrame has no real search-volume or demand data source.",
    "Demand cannot be honestly assessed from marketplace page evidence alone — this signal intentionally always reads insufficient evidence rather than guessing.",
    "low"
  );
}

function evidenceConfidenceSignal(clips: MatchableClip[], marketplaces: string[]): OpportunitySignal {
  const n = clips.length;
  const status: SignalStatus = n === 0 ? "INSUFFICIENT_EVIDENCE" : n === 1 ? "WEAK" : n <= 4 ? "MODERATE" : "STRONG";
  return signal(
    "Evidence Confidence",
    status,
    `${n} book(s) captured across ${marketplaces.length} marketplace(s).`,
    "More captured evidence generally supports more reliable analysis, but this remains a user-curated sample, not a market census.",
    n >= 5 ? "medium" : "low"
  );
}

/**
 * Opportunity Signals for a Competition Set — deterministic, explainable,
 * never a single opaque number. See the module doc above for why each
 * signal is shaped the way it is.
 */
export function computeOpportunitySignals(clips: MatchableClip[]): OpportunitySignals {
  const marketplaces = [...new Set(clips.map((c) => c.marketplace))];
  const captureDates = clips.map((c) => c.clipped_at).sort();

  const sample: MarketSample = {
    booksAnalyzed: clips.length,
    marketplaces,
    earliestCapture: captureDates[0] ?? null,
    latestCapture: captureDates[captureDates.length - 1] ?? null,
  };

  const signals = [
    competitionSignal(clips),
    crossPlatformSignal(clips, marketplaces),
    pricePositioningSignal(clips),
    marketMomentumSignal(clips),
    differentiationSignal(clips),
    demandSignal(),
    evidenceConfidenceSignal(clips, marketplaces),
  ];

  return {
    signals,
    sample,
    calculationVersion: OPPORTUNITY_SIGNALS_CALCULATION_VERSION,
    disclaimer:
      "Decision support drawn only from books you've captured into this set — a curated sample, never a live market census, " +
      "a sales prediction, or a claim of exhaustive analysis.",
  };
}

export type MarketScanResult = {
  booksAnalyzed: number;
  observedCategories: number;
  topClusters: { label: string; keywords: string[]; matchingBooks: number }[];
  priceRange: { min: number; max: number; avg: number } | null;
  disclaimer: string;
};

/**
 * Research's Market Scanner — reuses the exact same frequency/clustering
 * tooling the Research Department already uses (lib/research-frequency.ts),
 * applied to a set of already-captured books instead of live-scanning a
 * marketplace page. "Books analyzed" is always the real count of clips
 * passed in, never a claim about the whole market.
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
    disclaimer: "Computed only from books you've captured so far — a sample you collected, not a full market census.",
  };
}

/**
 * Evidence Completeness, Freshness, and Evidence Quality (spec sections
 * 8, 33, 34) — deliberately NOT a market or opportunity score. These
 * answer "how much usable evidence did InkFrame receive, and how
 * current is it?", nothing about the market itself. Every marketplace
 * legitimately exposes different fields (Amazon publishes a BSR, Kobo
 * and Google Play Books don't), so completeness is computed against
 * each marketplace's own expected field set — a Kobo clip is never
 * penalized for lacking a field no marketplace but Amazon publishes.
 */

export type FieldStatus = "observed" | "unavailable";
export type EvidenceFieldReport = { field: string; status: FieldStatus };
export type EvidenceCompleteness = { observedCount: number; totalExpected: number; pct: number; fields: EvidenceFieldReport[] };
export type Freshness = "CURRENT" | "RECENT" | "AGING" | "OLD";
export type EvidenceQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export const FRESHNESS_THRESHOLDS_DAYS = { current: 7, recent: 30, aging: 90 };

const COMMON_FIELDS = ["title", "author", "price", "category", "rating", "review_count", "isbn", "published_date", "publisher"] as const;
const AMAZON_ONLY_FIELDS = ["bsr", "category_rank"] as const;

export const MARKETPLACE_EXPECTED_FIELDS: Record<string, readonly string[]> = {
  amazon: [...COMMON_FIELDS, ...AMAZON_ONLY_FIELDS],
  google_play_books: COMMON_FIELDS,
  kobo: COMMON_FIELDS,
};

export type EvidenceClipShape = {
  marketplace: string;
  title: string | null;
  author: string | null;
  price: number | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  isbn: string | null;
  published_date: string | null;
  publisher: string | null;
  bsr: number | null;
  category_rank: number | null;
  clipped_at: string;
};

/** "How much usable evidence did InkFrame receive?" — not a market score. */
export function computeEvidenceCompleteness(clip: EvidenceClipShape): EvidenceCompleteness {
  const expected = MARKETPLACE_EXPECTED_FIELDS[clip.marketplace] ?? COMMON_FIELDS;
  const record = clip as unknown as Record<string, unknown>;
  const fields: EvidenceFieldReport[] = expected.map((field) => ({
    field,
    status: record[field] != null ? "observed" : "unavailable",
  }));
  const observedCount = fields.filter((f) => f.status === "observed").length;
  return {
    observedCount,
    totalExpected: expected.length,
    pct: expected.length > 0 ? Math.round((observedCount / expected.length) * 100) : 0,
    fields,
  };
}

/** How old a captured observation is — never implies an old observation is current. */
export function computeFreshness(clippedAt: string, now: Date = new Date()): Freshness {
  const ageDays = (now.getTime() - new Date(clippedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= FRESHNESS_THRESHOLDS_DAYS.current) return "CURRENT";
  if (ageDays <= FRESHNESS_THRESHOLDS_DAYS.recent) return "RECENT";
  if (ageDays <= FRESHNESS_THRESHOLDS_DAYS.aging) return "AGING";
  return "OLD";
}

/** An evidence-quality assessment (spec section 34), NOT an opportunity score. */
export function computeEvidenceQuality(clip: EvidenceClipShape, now: Date = new Date()): EvidenceQuality {
  const completeness = computeEvidenceCompleteness(clip);
  const freshness = computeFreshness(clip.clipped_at, now);
  if (completeness.pct < 30) return "INSUFFICIENT";
  if (freshness === "OLD" || completeness.pct < 50) return "LOW";
  if (freshness === "AGING" || completeness.pct < 80) return "MEDIUM";
  return "HIGH";
}

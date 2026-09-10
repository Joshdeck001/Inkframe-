/**
 * The OBSERVED / CALCULATED / INFERRED / RECOMMENDED / USER INPUT /
 * UNKNOWN vocabulary (spec section 31) — a display mapping over data
 * this app already tracks (source_type + confidence), not a new
 * evidence concept or schema. Computed values (frequency counts, the
 * opportunity score, the coverage matrix) are always CALCULATED at the
 * call site, not through this function — this one only classifies
 * stored evidence rows.
 */
export type EvidenceClassification = "OBSERVED" | "CALCULATED" | "INFERRED" | "RECOMMENDED" | "USER INPUT" | "UNKNOWN";

export function classifyEvidence(sourceType: string, confidence: string | null | undefined): EvidenceClassification {
  if (sourceType === "user_provided") return "USER INPUT";
  if (sourceType === "live_web" || sourceType === "browser_clip") return "OBSERVED";
  if (sourceType === "ai_inference") {
    if (!confidence || confidence === "insufficient_data") return "UNKNOWN";
    if (confidence === "high" || confidence === "medium") return "INFERRED";
    return "RECOMMENDED";
  }
  return "UNKNOWN";
}

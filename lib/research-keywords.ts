/**
 * Real keyword intelligence: intent classification is deterministic
 * pattern-matching (never an AI guess), and the only numeric score
 * computed is specificity — derived purely from phrase length, a real
 * and defensible proxy for "how narrow is this search." Deliberately
 * does NOT compute a fabricated "Relevance: 98, Commercial: 88" style
 * composite score the way the spec's own example does — section 33's
 * "NO FAKE DATA" hard requirement (never populate an unmeasurable metric
 * with an invented number) takes precedence over that example. Where a
 * demand/competition signal exists, it's surfaced as-entered (real,
 * evidence-backed); where it doesn't, this says so instead of guessing.
 */

export type KeywordIntent =
  | "informational" | "commercial" | "transactional" | "comparison"
  | "problem_solving" | "beginner" | "advanced" | "audience_specific";

const INTENT_PATTERNS: [RegExp, KeywordIntent][] = [
  [/\b(vs|versus|compared? to)\b/, "comparison"],
  [/\b(problems?|fix(es|ing)?|troubleshoot\w*|issues?|errors?|broken|not working)\b/, "problem_solving"],
  [/\b(beginner|basics?|starter|intro|getting started|101)\b/, "beginner"],
  [/\b(advanced|expert|pro|mastery|master)\b/, "advanced"],
  [/\b(for (kids|teens|women|men|seniors|beginners|professionals))\b/, "audience_specific"],
  [/\b(buy|price|cheap|deal|discount|affordable)\b/, "transactional"],
  [/\b(best|top|review|recommended)\b/, "commercial"],
  [/\b(how to|what is|guide to|guide for|tutorial)\b/, "informational"],
];

export function classifyKeywordIntent(keyword: string): KeywordIntent {
  const k = keyword.toLowerCase();
  for (const [pattern, intent] of INTENT_PATTERNS) if (pattern.test(k)) return intent;
  return "informational";
}

export type ScoredKeyword = {
  keyword: string;
  intent: KeywordIntent;
  wordCount: number;
  specificityScore: number; // 0-100, purely a function of phrase length
  hasDemandEvidence: boolean;
  hasCompetitionEvidence: boolean;
};

export function scoreKeywords(
  keywords: { keyword: string; demand_signal: string | null; competition_signal: string | null }[]
): ScoredKeyword[] {
  return keywords.map((k) => {
    const wordCount = k.keyword.trim().split(/\s+/).filter(Boolean).length;
    return {
      keyword: k.keyword,
      intent: classifyKeywordIntent(k.keyword),
      wordCount,
      specificityScore: Math.min(100, wordCount * 20),
      hasDemandEvidence: !!k.demand_signal,
      hasCompetitionEvidence: !!k.competition_signal,
    };
  });
}

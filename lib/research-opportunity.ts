import type { KeywordCluster } from "@/lib/research-frequency";
import type { Gap } from "@/lib/research-gaps";

export type ScoreDimension = { label: string; score: number; basis: string };
export type OpportunityScore = { overall: number; dimensions: ScoreDimension[]; disclaimer: string };

/**
 * A transparent, deterministic opportunity score — every dimension is a
 * capped function of a real count (competitors found, keyword clusters
 * formed, gaps detected), never an AI-invented number. This is
 * deliberately NOT a sales prediction: it measures how much evidence
 * points toward an opportunity being worth a closer look, which is a
 * fundamentally different (and honest) claim than "this will sell."
 * `basis` always cites the exact input that produced the score so a user
 * can see precisely why a number is what it is — the spec's own "explain
 * why each score exists" requirement.
 */
export function scoreOpportunity(input: {
  competitorCount: number;
  clusters: KeywordCluster[];
  gaps: Gap[];
  keywordsWithDemandSignal: number;
  seriesSignals: number; // competitor rows or notes indicating a series pattern
}): OpportunityScore {
  const { competitorCount, clusters, gaps, keywordsWithDemandSignal, seriesSignals } = input;

  const demand: ScoreDimension = {
    label: "Demand signal (evidence volume)",
    score: Math.min(100, keywordsWithDemandSignal * 12),
    basis: `${keywordsWithDemandSignal} keyword row(s) carry an observed demand signal.`,
  };

  const competitionDensity = Math.min(100, competitorCount * 12);
  const competition: ScoreDimension = {
    label: "Competition density",
    score: competitionDensity,
    basis: `${competitorCount} competitor(s) recorded — higher means more crowded, not necessarily worse.`,
  };

  const keywordOpportunity: ScoreDimension = {
    label: "Keyword opportunity",
    score: Math.min(100, clusters.length * 14),
    basis: `${clusters.length} distinct keyword cluster(s) identified from the evidence collected.`,
  };

  const differentiation: ScoreDimension = {
    label: "Differentiation / content gaps",
    score: Math.min(100, gaps.length * 20),
    basis: `${gaps.length} content gap(s) found — themes with reader-side keyword support that competitors don't visibly cover.`,
  };

  const seriesPotential: ScoreDimension = {
    label: "Series potential",
    score: Math.min(100, seriesSignals * 25 + Math.min(clusters.length, 3) * 10),
    basis: `${seriesSignals} series signal(s) noted, plus ${Math.min(clusters.length, 3)} related keyword cluster(s) that could map to sequential installments.`,
  };

  const dimensions = [demand, competition, keywordOpportunity, differentiation, seriesPotential];
  const overall = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);

  return {
    overall,
    dimensions,
    disclaimer:
      "Decision support, not a sales prediction. This score reflects how much of the evidence collected points toward " +
      "an opportunity worth investigating further — it is not an estimate of units sold, revenue, or guaranteed success.",
  };
}

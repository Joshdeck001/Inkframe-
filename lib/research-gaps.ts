import type { KeywordCluster } from "@/lib/research-frequency";

export type CompetitorEvidence = {
  content_gap: string | null;
  recurring_complaints: string | null;
  strengths: string | null;
  positioning: string | null;
};

export type Gap = {
  theme: string;
  reason: string;
  supportingKeywords: string[];
  reportedByCompetitors: number;
};

/**
 * Real gap detection: a set comparison between what readers appear to
 * want (keyword clusters, already grouped structurally in
 * lib/research-frequency.ts) and what competitors are recorded as
 * actually covering (their own strengths/positioning text) or explicitly
 * flagged as missing (content_gap/recurring_complaints). A theme only
 * surfaces as a gap when it's grounded in real entered data — either an
 * explicit competitor-reported gap, or a keyword cluster with more than
 * one member that no competitor's coverage text mentions at all. Never
 * invents a gap from nothing.
 */
export function findGaps(clusters: KeywordCluster[], competitors: CompetitorEvidence[]): Gap[] {
  const coverageText = competitors.map((c) => [c.strengths, c.positioning].filter(Boolean).join(" ")).join(" ").toLowerCase();

  const gaps: Gap[] = [];
  for (const cluster of clusters) {
    const reportingCompetitors = competitors.filter((c) => {
      const flagged = [c.content_gap, c.recurring_complaints].filter(Boolean).join(" ").toLowerCase();
      return flagged.includes(cluster.label);
    });

    if (reportingCompetitors.length > 0) {
      gaps.push({
        theme: cluster.label,
        reason: `Directly reported as a gap or recurring complaint in ${reportingCompetitors.length} competitor row(s).`,
        supportingKeywords: cluster.keywords,
        reportedByCompetitors: reportingCompetitors.length,
      });
      continue;
    }

    const covered = coverageText.includes(cluster.label);
    if (!covered && cluster.keywords.length >= 2) {
      gaps.push({
        theme: cluster.label,
        reason: `${cluster.keywords.length} related keyword(s) found for this theme, but no competitor's recorded strengths/positioning mention it.`,
        supportingKeywords: cluster.keywords,
        reportedByCompetitors: 0,
      });
    }
  }

  return gaps.sort((a, b) => b.supportingKeywords.length - a.supportingKeywords.length);
}

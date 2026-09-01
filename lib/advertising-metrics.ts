// Computed on read, never stored: CTR, CPC, ACOS, ROAS, conversion rate.
// Every one of these must handle zero/null safely — "Cannot be calculated
// from available data" instead of NaN/Infinity, per the schema's explicit
// rule. Never invent a number: an aggregate with no real metrics behind it
// is "Not available", never 0.

export type MetricTotals = {
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  orders: number | null;
  sales: number | null;
};

const NOT_AVAILABLE = "Not available";
const CANNOT_CALCULATE = "Cannot be calculated from available data";

export function sumMetrics(
  rows: { impressions: number | null; clicks: number | null; spend: number | null; orders: number | null; sales: number | null }[]
): MetricTotals {
  if (rows.length === 0) {
    return { impressions: null, clicks: null, spend: null, orders: null, sales: null };
  }
  const sum = (key: keyof MetricTotals) => {
    const values = rows.map((r) => r[key]).filter((v): v is number => v !== null && v !== undefined);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };
  return { impressions: sum("impressions"), clicks: sum("clicks"), spend: sum("spend"), orders: sum("orders"), sales: sum("sales") };
}

export function formatAcos(totals: MetricTotals): string {
  if (totals.spend === null || totals.sales === null) return NOT_AVAILABLE;
  if (totals.sales === 0) return CANNOT_CALCULATE;
  return `${((totals.spend / totals.sales) * 100).toFixed(1)}%`;
}

export function formatRoas(totals: MetricTotals): string {
  if (totals.spend === null || totals.sales === null) return NOT_AVAILABLE;
  if (totals.spend === 0) return CANNOT_CALCULATE;
  return `${(totals.sales / totals.spend).toFixed(2)}x`;
}

export function formatSpend(totals: MetricTotals): string {
  return totals.spend === null ? NOT_AVAILABLE : `$${totals.spend.toFixed(2)}`;
}

export function formatCtr(totals: MetricTotals): string {
  if (totals.impressions === null || totals.clicks === null) return NOT_AVAILABLE;
  if (totals.impressions === 0) return CANNOT_CALCULATE;
  return `${((totals.clicks / totals.impressions) * 100).toFixed(2)}%`;
}

export function formatCpc(totals: MetricTotals): string {
  if (totals.spend === null || totals.clicks === null) return NOT_AVAILABLE;
  if (totals.clicks === 0) return CANNOT_CALCULATE;
  return `$${(totals.spend / totals.clicks).toFixed(2)}`;
}

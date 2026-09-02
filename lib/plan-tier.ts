// One env var, changeable in Vercel's dashboard with no code edit and no
// redeploy-by-Claude-Code required: Settings -> Environment Variables ->
// PLAN_TIER -> "free" or "pro" -> Redeploy (the dashboard's own button).
//
// What this can and can't control, and why:
// - THROUGHPUT (how many chapters/units of work happen per invocation) is
//   fully controlled here — see maxPassesForTier() below.
// - FREQUENCY (how often Vercel actually invokes /api/cron/all) is NOT
//   controllable from an application env var. Vercel evaluates cron
//   schedules from the static `schedule` string in vercel.json at deploy
//   time, checked against the account's real plan — an env var is not
//   part of that evaluation at all. Changing real frequency needs either
//   editing vercel.json's schedule (a code change) or, with zero code
//   changes, pointing a free external scheduler (cron-job.org, GitHub
//   Actions on a schedule, UptimeRobot, etc.) at
//   POST/GET https://<your-domain>/api/cron/all with header
//   `Authorization: Bearer <CRON_SECRET>` at whatever interval you want —
//   configured entirely in that external tool's own dashboard.

export type PlanTier = "free" | "pro";

export function getPlanTier(): PlanTier {
  return (process.env.PLAN_TIER || "").trim().toLowerCase() === "pro" ? "pro" : "free";
}

/**
 * How many full passes through every department to run within one
 * invocation, before returning. Each pass does at most one unit of work
 * (one chapter, one quality check, etc.) per department, same as always —
 * this just controls how many times that loop repeats back to back within
 * budgetMsForTier()'s time budget. A pass that reports nothing left to do
 * stops the loop early regardless of tier, so this is a ceiling, not a
 * forced amount of work.
 */
export function maxPassesForTier(tier: PlanTier): number {
  return tier === "pro" ? 8 : 1;
}

/**
 * How much wall-clock time /api/cron/all's multi-pass loop is allowed to
 * use within one invocation, before the route's own maxDuration would cut
 * it off mid-request. Free stays well under Hobby's 60s ceiling even if
 * this project is ever downgraded back to it; pro leaves a ~20s safety
 * margin under the 300s maxDuration set on every AI-calling/cron route
 * once upgraded to Vercel Pro — see "Deploying on Vercel" in the README
 * for the maxDuration side of this. Bumping maxPassesForTier() without
 * also raising this would leave pro's extra passes unreachable in
 * practice, since the loop would still stop at the old free-tier budget.
 */
export function budgetMsForTier(tier: PlanTier): number {
  return tier === "pro" ? 280000 : 50000;
}

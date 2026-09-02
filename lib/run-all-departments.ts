import type { SupabaseClient } from "@supabase/supabase-js";
import { runWritingAgentTick } from "@/lib/writing-agent";
import { runQualityLoopTick } from "@/lib/quality-loop";
import { runCoverDepartmentTick } from "@/lib/cover-department";
import { runImageDepartmentTick } from "@/lib/image-department";
import { runMetadataDepartmentTick } from "@/lib/metadata-department";
import { runComplianceDepartmentTick } from "@/lib/compliance-department";
import { runFormattingDepartmentTick } from "@/lib/formatting-department";
import { runTranslationDepartmentTick } from "@/lib/translation-department";
import { getPlanTier, maxPassesForTier, type PlanTier } from "@/lib/plan-tier";

export type DepartmentTick = (supabase: SupabaseClient) => Promise<{ processed: boolean; detail: string }>;
export type DepartmentEntry = { name: string; run: DepartmentTick };
export type PassResult = { name: string; processed?: boolean; detail?: string; error?: string; skipped?: boolean };

export const DEPARTMENTS: DepartmentEntry[] = [
  { name: "writing-agent", run: runWritingAgentTick },
  { name: "quality-loop", run: runQualityLoopTick },
  { name: "cover-department", run: runCoverDepartmentTick },
  { name: "image-department", run: runImageDepartmentTick },
  { name: "metadata-department", run: runMetadataDepartmentTick },
  { name: "compliance-department", run: runComplianceDepartmentTick },
  { name: "formatting-department", run: runFormattingDepartmentTick },
  { name: "translation-department", run: runTranslationDepartmentTick },
];

/**
 * Runs every department's tick once, in sequence, stopping early if the
 * time budget runs out. `departments` defaults to the real list but can be
 * swapped out — that's what makes the multi-pass loop below testable
 * without a live Supabase connection (see scripts/test-plan-tier.ts).
 */
export async function runAllDepartmentsTick(
  supabase: SupabaseClient,
  budgetMs = 50000,
  departments: DepartmentEntry[] = DEPARTMENTS
): Promise<{ results: PassResult[] }> {
  const start = Date.now();
  const results: PassResult[] = [];

  for (const { name, run } of departments) {
    if (Date.now() - start > budgetMs) {
      results.push({ name, skipped: true, detail: "Skipped — time budget exceeded for this invocation." });
      continue;
    }
    try {
      const result = await run(supabase);
      results.push({ name, ...result });
    } catch (e) {
      results.push({ name, processed: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { results };
}

/**
 * PLAN_TIER-aware entry point: loops runAllDepartmentsTick up to
 * maxPassesForTier(tier) times within one invocation (so PLAN_TIER=pro
 * does more chapters/units of work per firing than PLAN_TIER=free),
 * stopping early either when the overall time budget runs out or when a
 * full pass processes nothing at all (no point looping further — there's
 * simply no work waiting). This is a per-invocation throughput control
 * only; see lib/plan-tier.ts for why cron *frequency* can't work the
 * same way.
 */
export async function runPlanTierTick(
  supabase: SupabaseClient,
  opts: { tier?: PlanTier; overallBudgetMs?: number; departments?: DepartmentEntry[] } = {}
): Promise<{ tier: PlanTier; passes: PassResult[][] }> {
  const tier = opts.tier ?? getPlanTier();
  const maxPasses = maxPassesForTier(tier);
  const overallBudgetMs = opts.overallBudgetMs ?? 50000;
  const start = Date.now();

  const passes: PassResult[][] = [];

  for (let i = 0; i < maxPasses; i++) {
    const elapsed = Date.now() - start;
    if (elapsed > overallBudgetMs) break;

    const { results } = await runAllDepartmentsTick(supabase, overallBudgetMs - elapsed, opts.departments);
    passes.push(results);

    const didAnyWork = results.some((r) => r.processed);
    if (!didAnyWork) break; // nothing left in the queue — stop early regardless of tier
  }

  return { tier, passes };
}

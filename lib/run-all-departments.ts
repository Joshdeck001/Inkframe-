import type { SupabaseClient } from "@supabase/supabase-js";
import { runWritingAgentTick } from "@/lib/writing-agent";
import { runQualityLoopTick } from "@/lib/quality-loop";
import { runCoverDepartmentTick } from "@/lib/cover-department";
import { runMetadataDepartmentTick } from "@/lib/metadata-department";
import { runComplianceDepartmentTick } from "@/lib/compliance-department";
import { runFormattingDepartmentTick } from "@/lib/formatting-department";
import { runTranslationDepartmentTick } from "@/lib/translation-department";

const DEPARTMENTS: { name: string; run: (supabase: SupabaseClient) => Promise<{ processed: boolean; detail: string }> }[] = [
  { name: "writing-agent", run: runWritingAgentTick },
  { name: "quality-loop", run: runQualityLoopTick },
  { name: "cover-department", run: runCoverDepartmentTick },
  { name: "metadata-department", run: runMetadataDepartmentTick },
  { name: "compliance-department", run: runComplianceDepartmentTick },
  { name: "formatting-department", run: runFormattingDepartmentTick },
  { name: "translation-department", run: runTranslationDepartmentTick },
];

/**
 * Runs every department's tick in sequence within one invocation, stopping
 * early if the time budget runs out. This exists because Vercel's Hobby
 * plan allows at most 2 cron jobs, running no more than once a day — one
 * consolidated cron pays that cost once instead of needing 7 separate
 * jobs. On Vercel Pro (no such cron limits), the individual /api/cron/*
 * routes can still be scheduled directly, far more often, if preferred.
 */
export async function runAllDepartmentsTick(supabase: SupabaseClient, budgetMs = 50000) {
  const start = Date.now();
  const results: { name: string; processed?: boolean; detail?: string; error?: string; skipped?: boolean }[] = [];

  for (const { name, run } of DEPARTMENTS) {
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

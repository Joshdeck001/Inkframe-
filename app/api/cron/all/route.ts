import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runPlanTierTick } from "@/lib/run-all-departments";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling — see lib/plan-tier.ts for why frequency can't be env-driven

/**
 * The one cron job registered in vercel.json — kept as a single
 * consolidated job even on Pro (which allows more/shorter-interval crons)
 * because every department's tick already runs here in sequence within a
 * shared time budget, and splitting it back into one cron per department
 * would just mean the same total work spread across more scheduled
 * invocations for no real benefit. PLAN_TIER (Settings -> Environment
 * Variables in Vercel's dashboard, no code change) controls how many
 * passes through every department happen per invocation — see
 * lib/plan-tier.ts. The per-department routes under /api/cron/<name>
 * still exist and work the same way — call them directly (with the same
 * Bearer CRON_SECRET) for local testing, or register them individually in
 * vercel.json instead of this one if you'd rather have Vercel invoke them
 * separately.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPlanTierTick(createServiceClient());
  return NextResponse.json(result);
}

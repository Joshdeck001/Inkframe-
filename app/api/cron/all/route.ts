import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAllDepartmentsTick } from "@/lib/run-all-departments";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby plan's ceiling — see lib/run-all-departments.ts

/**
 * The one cron job registered in vercel.json. Vercel Hobby allows at most
 * 2 cron jobs and only a daily schedule, so every department's tick runs
 * here in sequence instead of each having its own schedule. The
 * per-department routes under /api/cron/<name> still exist and work the
 * same way — call them directly (with the same Bearer CRON_SECRET) for
 * local testing, or register them individually in vercel.json instead of
 * this one if the project is on a plan without Hobby's cron limits.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAllDepartmentsTick(createServiceClient());
  return NextResponse.json(result);
}

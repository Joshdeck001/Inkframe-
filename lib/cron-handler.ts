import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared boilerplate for every /api/cron/* route: verify CRON_SECRET, run one tick, report the outcome. */
export function cronRoute(tick: (supabase: SupabaseClient) => Promise<{ processed: boolean; detail: string }>) {
  return async function GET(request: Request) {
    const authHeader = request.headers.get("authorization");
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const result = await tick(createServiceClient());
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Tick failed." }, { status: 500 });
    }
  };
}

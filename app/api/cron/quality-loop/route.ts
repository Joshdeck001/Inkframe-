import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runQualityLoopTick } from "@/lib/quality-loop";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const result = await runQualityLoopTick(supabase);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Quality Loop tick failed." },
      { status: 500 }
    );
  }
}

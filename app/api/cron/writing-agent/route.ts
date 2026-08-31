import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runWritingAgentTick } from "@/lib/writing-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // one chapter can take a while to draft; may need a paid plan above 60s

/**
 * Triggered by Vercel Cron (see vercel.json) on a schedule, or manually
 * during local dev with the same CRON_SECRET. Not tied to any open browser
 * tab — this is what actually makes "you can close this tab" true.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const result = await runWritingAgentTick(supabase);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Writing Agent tick failed." },
      { status: 500 }
    );
  }
}

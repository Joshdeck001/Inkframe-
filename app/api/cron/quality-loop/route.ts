import { cronRoute } from "@/lib/cron-handler";
import { runQualityLoopTick } from "@/lib/quality-loop";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const GET = cronRoute(runQualityLoopTick);

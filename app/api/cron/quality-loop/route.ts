import { cronRoute } from "@/lib/cron-handler";
import { runQualityLoopTick } from "@/lib/quality-loop";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby plan's ceiling

export const GET = cronRoute(runQualityLoopTick);

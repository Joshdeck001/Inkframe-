import { cronRoute } from "@/lib/cron-handler";
import { runWritingAgentTick } from "@/lib/writing-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const GET = cronRoute(runWritingAgentTick);

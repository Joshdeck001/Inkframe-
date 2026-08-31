import { cronRoute } from "@/lib/cron-handler";
import { runWritingAgentTick } from "@/lib/writing-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // one chapter can take a while to draft; may need a paid plan above 60s

export const GET = cronRoute(runWritingAgentTick);

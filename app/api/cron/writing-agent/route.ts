import { cronRoute } from "@/lib/cron-handler";
import { runWritingAgentTick } from "@/lib/writing-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby plan's ceiling — a very long chapter draft could still hit this; Pro allows more

export const GET = cronRoute(runWritingAgentTick);

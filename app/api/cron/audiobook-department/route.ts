import { cronRoute } from "@/lib/cron-handler";
import { runAudiobookDepartmentTick } from "@/lib/audiobook-department";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const GET = cronRoute(runAudiobookDepartmentTick);

import { cronRoute } from "@/lib/cron-handler";
import { runCoverDepartmentTick } from "@/lib/cover-department";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const GET = cronRoute(runCoverDepartmentTick);

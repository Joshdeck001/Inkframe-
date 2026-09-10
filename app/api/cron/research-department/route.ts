import { cronRoute } from "@/lib/cron-handler";
import { runResearchDepartmentTick } from "@/lib/research-department";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const GET = cronRoute(runResearchDepartmentTick);

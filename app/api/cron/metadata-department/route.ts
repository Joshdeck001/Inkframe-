import { cronRoute } from "@/lib/cron-handler";
import { runMetadataDepartmentTick } from "@/lib/metadata-department";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const GET = cronRoute(runMetadataDepartmentTick);

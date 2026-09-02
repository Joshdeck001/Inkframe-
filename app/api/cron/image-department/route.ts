import { cronRoute } from "@/lib/cron-handler";
import { runImageDepartmentTick } from "@/lib/image-department";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const GET = cronRoute(runImageDepartmentTick);

import { cronRoute } from "@/lib/cron-handler";
import { runImageDepartmentTick } from "@/lib/image-department";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = cronRoute(runImageDepartmentTick);

import { cronRoute } from "@/lib/cron-handler";
import { runCoverDepartmentTick } from "@/lib/cover-department";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = cronRoute(runCoverDepartmentTick);

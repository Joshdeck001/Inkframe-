import { cronRoute } from "@/lib/cron-handler";
import { runFormattingDepartmentTick } from "@/lib/formatting-department";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = cronRoute(runFormattingDepartmentTick);

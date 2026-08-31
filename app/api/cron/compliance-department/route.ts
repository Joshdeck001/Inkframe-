import { cronRoute } from "@/lib/cron-handler";
import { runComplianceDepartmentTick } from "@/lib/compliance-department";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = cronRoute(runComplianceDepartmentTick);

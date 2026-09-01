import { cronRoute } from "@/lib/cron-handler";
import { runTranslationDepartmentTick } from "@/lib/translation-department";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = cronRoute(runTranslationDepartmentTick);

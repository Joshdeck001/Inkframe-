import { cronRoute } from "@/lib/cron-handler";
import { runTranslationDepartmentTick } from "@/lib/translation-department";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby plan's ceiling

export const GET = cronRoute(runTranslationDepartmentTick);

import { cronRoute } from "@/lib/cron-handler";
import { runTranslationDepartmentTick } from "@/lib/translation-department";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

export const GET = cronRoute(runTranslationDepartmentTick);

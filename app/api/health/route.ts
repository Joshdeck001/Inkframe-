import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Development/staging diagnostics — "is the app actually running, and can
 * it reach its own database?" Never a scraper-fleet-style dashboard: this
 * checks InkFrame's own infrastructure (server + database), nothing about
 * InkframeScout's marketplace adapters. Reports only booleans for which AI
 * provider keys are configured — never their values, never partial keys.
 */
export async function GET() {
  let database: "ok" | "unreachable" | "not_configured" = "not_configured";
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const service = createServiceClient();
      const { error } = await service.from("profiles").select("id", { count: "exact", head: true }).limit(1);
      database = error ? "unreachable" : "ok";
    } catch {
      database = "unreachable";
    }
  }

  const providers = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  };

  const status = database === "ok" || database === "not_configured" ? 200 : 503;

  return NextResponse.json(
    {
      status: database === "ok" ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      database,
      ai_providers_configured: providers,
      cron_secret_configured: Boolean(process.env.CRON_SECRET),
      brave_search_configured: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    },
    { status }
  );
}

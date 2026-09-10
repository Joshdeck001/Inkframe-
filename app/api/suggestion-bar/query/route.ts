import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { classifySuggestionQuery } from "@/lib/suggestion-intent";
import { initStages } from "@/lib/research-department";
import { runDiscoveryStage, RESEARCH_PLATFORMS, type ResearchSession } from "@/lib/research-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Suggestion Bar's one new piece of backend (see "Suggestion Bar" in
 * README.md): classify the free-text query, and if it's genuinely a
 * research question, create a real research_sessions row — the exact
 * same shape /api/research/start already creates — and run its first
 * stage (discovery) synchronously so the user sees real progress
 * immediately instead of only "queued, check back later". Every stage
 * after that advances through the same background department tick
 * (lib/research-department.ts) every other research session already
 * uses; nothing here is a second pipeline.
 *
 * When the query isn't research-shaped (most likely a book title the
 * user is searching their own library for), this returns
 * `{ handled: false }` and the dashboard's existing local project
 * filter is the entire experience — nothing new fires.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { query } = await request.json();
  if (typeof query !== "string" || !query.trim()) return NextResponse.json({ error: "query is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  let classification;
  try {
    classification = await classifySuggestionQuery(supabase, user.id, query.trim());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not understand that query." }, { status: 502 });
  }

  if (!classification.is_research_question || !classification.mode) {
    return NextResponse.json({ handled: false, reasoning: classification.reasoning });
  }

  const platforms = classification.platforms.length > 0 ? classification.platforms : [...RESEARCH_PLATFORMS];

  const { data: session, error: insertError } = await supabase
    .from("research_sessions")
    .insert({
      user_id: user.id,
      topic: classification.topic.trim() || query.trim(),
      mode: classification.mode,
      platforms,
      status: "queued",
      stages: initStages(),
    })
    .select("id, topic, mode")
    .single();
  if (insertError || !session) return NextResponse.json({ error: insertError?.message || "Could not start research." }, { status: 500 });

  // First stage runs inline so the Suggestion Bar shows real progress right away; every
  // later stage advances through the normal background department tick, same as any
  // other research session — see lib/research-department.ts.
  const stages = initStages();
  const researchSession: ResearchSession = { id: session.id, user_id: user.id, topic: session.topic, mode: session.mode, platforms, project_id: null };
  try {
    await supabase.from("research_sessions").update({ status: "running", started_at: new Date().toISOString() }).eq("id", session.id);
    const result = await runDiscoveryStage(supabase, researchSession);
    stages[0] = { ...stages[0], status: "passed", detail: result.detail };
    await supabase.from("research_sessions").update({ stages }).eq("id", session.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    stages[0] = { ...stages[0], status: "failed", detail: message };
    await supabase.from("research_sessions").update({ status: "needs_attention", stages, error: message }).eq("id", session.id);
  }

  return NextResponse.json({ handled: true, session_id: session.id, topic: session.topic, mode: session.mode });
});

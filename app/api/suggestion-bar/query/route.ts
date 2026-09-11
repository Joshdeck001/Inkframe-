import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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
 * same shape /api/research/start already creates.
 *
 * A prior version of this route also ran the first (discovery) stage
 * synchronously, inline, before responding — meant to show real progress
 * right away instead of waiting for the 5-minute cron tick. In practice
 * that made this route's response time bounded by a real web-search +
 * AI stage on top of the classification call, which is exactly the
 * "stuck on Thinking" failure mode: the client's fetch — and the
 * `suggestionLoading` state driving the "Thinking…" label — stayed
 * blocked for however long that stage took, with no bound. Fixed by
 * running discovery via `after()` instead: the response (and therefore
 * `suggestionLoading`) resolves as soon as classification + the insert
 * are done — a single fast AI call — and discovery runs in the
 * background afterward, updating the same row the dashboard's existing
 * 4-second poll already watches. Every stage after discovery still
 * advances through the normal background department tick
 * (lib/research-department.ts) every other research session uses;
 * nothing here is a second pipeline.
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

  // Runs after the response above is already on its way to the browser — the
  // service client is used here (not the request-scoped `supabase`) because
  // this callback outlives the request/response cycle those cookies belong to.
  after(async () => {
    const service = createServiceClient();
    const stages = initStages();
    const researchSession: ResearchSession = { id: session.id, user_id: user.id, topic: session.topic, mode: session.mode, platforms, project_id: null };
    try {
      await service.from("research_sessions").update({ status: "running", started_at: new Date().toISOString() }).eq("id", session.id);
      const result = await runDiscoveryStage(service, researchSession);
      stages[0] = { ...stages[0], status: "passed", detail: result.detail };
      await service.from("research_sessions").update({ stages }).eq("id", session.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      stages[0] = { ...stages[0], status: "failed", detail: message };
      await service.from("research_sessions").update({ status: "needs_attention", stages, error: message }).eq("id", session.id);
    }
  });

  return NextResponse.json({ handled: true, session_id: session.id, topic: session.topic, mode: session.mode });
});

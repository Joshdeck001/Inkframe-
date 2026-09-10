import type { SupabaseClient } from "@supabase/supabase-js";
import { runDiscoveryStage, runExtractionStage, runAnalysisStage, runConceptsStage, runReportStage, type ResearchSession } from "@/lib/research-agent";

export type Stage = { key: string; label: string; status: "pending" | "passed" | "blocked" | "failed"; detail: string };

export const STAGE_ORDER: { key: string; label: string }[] = [
  { key: "discovery", label: "Search Discovery" },
  { key: "extraction", label: "Competitor & Keyword Collection" },
  { key: "analysis", label: "Keyword & Gap Analysis" },
  { key: "concepts", label: "Opportunity Concepts" },
  { key: "report", label: "Research Report" },
  { key: "finalize", label: "Finalize" },
];

export function initStages(): Stage[] {
  return STAGE_ORDER.map((s) => ({ key: s.key, label: s.label, status: "pending", detail: "" }));
}

/**
 * Background "Deep Research" processor — one stage of one research
 * session per tick, the same shape as every other department
 * (lib/kdp-preparation-department.ts, lib/audiobook-department.ts): pick
 * the oldest active session, advance exactly one stage, persist progress,
 * return. Resumable the same way too — a retry picks up at the first
 * stage that isn't 'passed' rather than redoing completed work (spec
 * section 36/42's background + failure-recovery requirements).
 */
export async function runResearchDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const { data: session, error: queryError } = await supabase
    .from("research_sessions")
    .select("id, user_id, topic, mode, platforms, project_id, stages, status")
    .in("status", ["queued", "running"])
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (queryError) throw new Error(`Could not query research_sessions: ${queryError.message}`);
  if (!session) return { processed: false, detail: "No research sessions waiting." };

  if (session.status === "queued") {
    await supabase.from("research_sessions").update({ status: "running", started_at: new Date().toISOString() }).eq("id", session.id);
  }

  const stages: Stage[] = Array.isArray(session.stages) && session.stages.length > 0 ? (session.stages as Stage[]) : initStages();
  const currentIndex = stages.findIndex((s) => s.status !== "passed");
  if (currentIndex === -1) {
    await supabase.from("research_sessions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", session.id);
    return { processed: true, detail: `Session ${session.id}: all stages already complete, marked completed.` };
  }
  const stage = stages[currentIndex];
  const researchSession: ResearchSession = {
    id: session.id,
    user_id: session.user_id,
    topic: session.topic,
    mode: session.mode,
    platforms: session.platforms ?? [],
    project_id: session.project_id,
  };

  try {
    let result: { detail: string };
    switch (stage.key) {
      case "discovery":
        result = await runDiscoveryStage(supabase, researchSession);
        break;
      case "extraction":
        result = await runExtractionStage(supabase, researchSession);
        break;
      case "analysis":
        result = await runAnalysisStage(supabase, researchSession);
        break;
      case "concepts":
        result = await runConceptsStage(supabase, researchSession);
        break;
      case "report":
        result = await runReportStage(supabase, researchSession);
        break;
      default:
        result = { detail: "Ready for review." };
    }

    stages[currentIndex] = { ...stage, status: "passed", detail: result.detail };

    if (stage.key === "finalize" || currentIndex === stages.length - 1) {
      await supabase
        .from("research_sessions")
        .update({ stages, status: "completed", completed_at: new Date().toISOString(), error: null })
        .eq("id", session.id);
      return { processed: true, detail: `Session ${session.id}: research complete — ${result.detail}` };
    }

    await supabase.from("research_sessions").update({ stages }).eq("id", session.id);
    return { processed: true, detail: `Session ${session.id}: stage "${stage.key}" passed — ${result.detail}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    stages[currentIndex] = { ...stage, status: "failed", detail: message };
    await supabase.from("research_sessions").update({ status: "needs_attention", stages, error: message }).eq("id", session.id);
    return { processed: true, detail: `Session ${session.id}: stage "${stage.key}" failed — ${message}` };
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Project ids the user has paused via the AI Copilot's "Pause Production"
 * control. Department ticks filter these out so a paused project is
 * genuinely skipped, not just marked paused in the UI.
 */
export async function getPausedProjectIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("copilot_sessions")
    .select("project_id")
    .eq("production_paused", true);
  if (error) throw new Error(`Could not query paused projects: ${error.message}`);
  return Array.from(new Set((data ?? []).map((r) => r.project_id as string)));
}

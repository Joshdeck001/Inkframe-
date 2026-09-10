import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAcceptedResearchFacts } from "@/lib/research-context";

/**
 * The structured book context every cover-art prompt is built from —
 * assembled automatically from what InkFrame already knows about the
 * project, so the author never re-types information it already has
 * (spec section 3). Only carries fields real data actually exists for:
 * no `characters`/`visualMotifs`/`setting` here, because nothing in this
 * schema populates them today — a field with no real source would just
 * be permanently empty, so it isn't declared at all rather than shipped
 * as dead weight (same discipline as BookPassport's own doc comment).
 */
export type CoverBrief = {
  title: string;
  subtitle: string | null;
  authorName: string | null;
  bookType: string;
  synopsis: string | null;
  targetAudience: string | null;
  tone: string | null;
  pov: string | null;
  seriesName: string | null;
  seriesNumber: number | null;
  openPlotThreads: string[];
  researchFacts: string[];
};

export async function assembleCoverBrief(supabase: SupabaseClient, projectId: string): Promise<CoverBrief> {
  const [{ data: project }, { data: identity }, { data: audience }, { data: style }, { data: storyBible }, researchFacts] = await Promise.all([
    supabase.from("projects").select("book_type").eq("id", projectId).single(),
    supabase.from("project_identity").select("working_title, subtitle, author_name, pen_name, series_name, series_number, initial_idea").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_audience").select("target_audience").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_style").select("tone, pov").eq("project_id", projectId).maybeSingle(),
    supabase.from("story_bible").select("plot_threads").eq("project_id", projectId).maybeSingle(),
    fetchAcceptedResearchFacts(supabase, projectId),
  ]);

  const plotThreads = (storyBible?.plot_threads as { thread: string; status: string }[] | null) ?? [];

  return {
    title: identity?.working_title || "Untitled Project",
    subtitle: identity?.subtitle ?? null,
    authorName: identity?.pen_name || identity?.author_name || null,
    bookType: project?.book_type ?? "Fiction",
    synopsis: identity?.initial_idea ?? null,
    targetAudience: audience?.target_audience ?? null,
    tone: style?.tone ?? null,
    pov: style?.pov ?? null,
    seriesName: identity?.series_name ?? null,
    seriesNumber: identity?.series_number ?? null,
    openPlotThreads: plotThreads.filter((t) => t.status === "open").map((t) => t.thread),
    researchFacts,
  };
}

/** Renders a CoverBrief into the plain-fact lines every prompt-building function in this app already expects. */
export function coverBriefToPromptFacts(brief: CoverBrief): string[] {
  return [
    `Title: ${brief.title}`,
    brief.subtitle ? `Subtitle: ${brief.subtitle}` : null,
    brief.authorName ? `Author: ${brief.authorName}` : null,
    `Book type/genre: ${brief.bookType}`,
    brief.synopsis ? `Synopsis/idea: ${brief.synopsis}` : null,
    brief.targetAudience ? `Target audience: ${brief.targetAudience}` : null,
    brief.tone ? `Tone: ${brief.tone}` : null,
    brief.pov ? `POV: ${brief.pov}` : null,
    brief.seriesName ? `Series: ${brief.seriesName}${brief.seriesNumber ? ` #${brief.seriesNumber}` : ""}` : null,
    brief.openPlotThreads.length ? `Open story threads: ${brief.openPlotThreads.join("; ")}` : null,
    ...brief.researchFacts,
  ].filter((l): l is string => !!l);
}

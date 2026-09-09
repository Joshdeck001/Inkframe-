import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Book Passport: a single, read-only assembly of the canonical record
 * that already exists for every project — spread today across
 * project_identity/scope/audience/style/platform, quality_gate,
 * cover_department, metadata_department, translation_jobs, format_editions,
 * publishing_jobs, and audiobook_jobs. This does not add any new data or
 * any new source of truth; it just answers "what do we know about this
 * book, and what stage is each part in" in one read, instead of visiting
 * six different pages. Shared between the /passport page (browser client)
 * and the production-package route (service-role client) so the two never
 * drift out of sync with each other.
 *
 * Only surfaces what InkFrame actually tracks — there is no "genre" or
 * "target countries" column anywhere in the schema today, so this never
 * invents placeholder values for them; a field simply isn't present rather
 * than being faked.
 */
export type BookPassport = {
  projectId: string;
  bookType: string;
  workflowStage: string;
  identity: {
    workingTitle: string | null;
    subtitle: string | null;
    authorName: string | null;
    penName: string | null;
    seriesName: string | null;
    seriesNumber: number | null;
    language: string | null;
    targetMarketplace: string | null;
  } | null;
  audience: {
    targetAudience: string | null;
    readerLevel: string | null;
    corePromise: string | null;
    purpose: string | null;
  } | null;
  style: {
    tone: string | null;
    pov: string | null;
    pacing: string | null;
    depth: string | null;
  } | null;
  scope: {
    targetWordCount: number | null;
    wordsWritten: number;
    estimatedChapterCount: number | null;
    trimSize: string | null;
  } | null;
  platform: {
    platformTarget: string | null;
  } | null;
  chapters: { total: number; approved: number; titles: { number: number; title: string | null }[] };
  qualityGate: {
    overallReadinessScore: number | null;
    contentCheck: boolean;
    structureCheck: boolean;
    continuityCheck: boolean;
    wordCountCheck: boolean;
    metadataCheck: boolean;
    platformCheck: boolean;
    formattingCheck: boolean;
    coverCheck: boolean;
  } | null;
  cover: { status: "not_started" | "in_progress" | "done"; finalCoverRef: string | null };
  metadata: { status: "not_started" | "done"; keywordCount: number; categoryCount: number };
  formatting: { editions: { formatType: string; status: string; pageCount: number | null; price: number | null }[] };
  translations: { language: string; status: string | null }[];
  audiobook: { status: string | null; voice: string | null } | null;
  publishing: { targetPlatform: string; status: string }[];
  marketing: { hasStrategy: boolean };
};

export async function assembleBookPassport(supabase: SupabaseClient, projectId: string): Promise<BookPassport | null> {
  const [
    { data: project },
    { data: identity },
    { data: audience },
    { data: style },
    { data: scope },
    { data: platform },
    { data: chapters },
    { data: qualityGate },
    { data: cover },
    { data: metadata },
    { data: formatEditions },
    { data: translationJobs },
    { data: audiobookJob },
    { data: publishingJobs },
    { data: advertisingProject },
  ] = await Promise.all([
    supabase.from("projects").select("id, book_type, status").eq("id", projectId).maybeSingle(),
    supabase.from("project_identity").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_audience").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_style").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_scope").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_platform").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("chapters").select("chapter_number, title, status").eq("project_id", projectId).order("chapter_number", { ascending: true }),
    supabase.from("quality_gate").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("cover_department").select("concepts, final_cover_ref").eq("project_id", projectId).maybeSingle(),
    supabase.from("metadata_department").select("keywords, categories").eq("project_id", projectId).maybeSingle(),
    supabase.from("format_editions").select("format_type, status, page_count, price").eq("project_id", projectId),
    supabase.from("translation_jobs").select("target_languages, translated_outputs, status").eq("source_project_id", projectId),
    supabase.from("audiobook_jobs").select("status, voice").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("publishing_jobs").select("target_platform, status").eq("project_id", projectId),
    supabase.from("advertising_projects").select("id").eq("project_id", projectId).maybeSingle(),
  ]);

  if (!project) return null;

  const chapterRows = chapters ?? [];
  const coverConcepts = Array.isArray(cover?.concepts) ? (cover!.concepts as { status: string }[]) : [];
  const coverStatus: BookPassport["cover"]["status"] = cover?.final_cover_ref
    ? "done"
    : coverConcepts.length > 0
      ? "in_progress"
      : "not_started";

  const translations: BookPassport["translations"] = [];
  for (const job of translationJobs ?? []) {
    const outputs = Array.isArray(job.translated_outputs) ? (job.translated_outputs as { language: string; file_ref: string | null }[]) : [];
    for (const lang of (job.target_languages as string[] | null) ?? []) {
      const output = outputs.find((o) => o.language === lang);
      translations.push({ language: lang, status: output?.file_ref ? "complete" : job.status });
    }
  }

  return {
    projectId,
    bookType: project.book_type,
    workflowStage: project.status,
    identity: identity
      ? {
          workingTitle: identity.working_title,
          subtitle: identity.subtitle,
          authorName: identity.author_name,
          penName: identity.pen_name,
          seriesName: identity.series_name,
          seriesNumber: identity.series_number,
          language: identity.language,
          targetMarketplace: identity.target_marketplace,
        }
      : null,
    audience: audience
      ? {
          targetAudience: audience.target_audience,
          readerLevel: audience.reader_level,
          corePromise: audience.core_promise,
          purpose: audience.purpose,
        }
      : null,
    style: style ? { tone: style.tone, pov: style.pov, pacing: style.pacing, depth: style.depth } : null,
    scope: scope
      ? {
          targetWordCount: scope.target_word_count,
          wordsWritten: scope.words_written,
          estimatedChapterCount: scope.estimated_chapter_count,
          trimSize: scope.trim_size,
        }
      : null,
    platform: platform ? { platformTarget: platform.platform_target } : null,
    chapters: {
      total: chapterRows.length,
      approved: chapterRows.filter((c) => c.status === "approved").length,
      titles: chapterRows.map((c) => ({ number: c.chapter_number, title: c.title })),
    },
    qualityGate: qualityGate
      ? {
          overallReadinessScore: qualityGate.overall_readiness_score,
          contentCheck: qualityGate.content_check,
          structureCheck: qualityGate.structure_check,
          continuityCheck: qualityGate.continuity_check,
          wordCountCheck: qualityGate.word_count_check,
          metadataCheck: qualityGate.metadata_check,
          platformCheck: qualityGate.platform_check,
          formattingCheck: qualityGate.formatting_check,
          coverCheck: qualityGate.cover_check,
        }
      : null,
    cover: { status: coverStatus, finalCoverRef: cover?.final_cover_ref ?? null },
    metadata: {
      status: metadata ? "done" : "not_started",
      keywordCount: metadata?.keywords?.length ?? 0,
      categoryCount: metadata?.categories?.length ?? 0,
    },
    formatting: {
      editions: (formatEditions ?? []).map((e) => ({
        formatType: e.format_type,
        status: e.status,
        pageCount: e.page_count,
        price: e.price,
      })),
    },
    translations,
    audiobook: audiobookJob ? { status: audiobookJob.status, voice: audiobookJob.voice } : null,
    publishing: (publishingJobs ?? []).map((p) => ({ targetPlatform: p.target_platform, status: p.status })),
    marketing: { hasStrategy: !!advertisingProject },
  };
}

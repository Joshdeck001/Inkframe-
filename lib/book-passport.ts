import type { SupabaseClient } from "@supabase/supabase-js";
import { buildNormalizedDocumentModel, validateDocumentStructure, type RawSection } from "@/lib/document-model";

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
  ebookFormatting: { status: string | null; outputFormats: string[] };
  /** Real structural health (lib/document-model.ts) — duplicate conclusions, unresolved placeholders, un-reviewed low-confidence section classification, broken Unicode. Computed fresh from current chapters every time, never a stale snapshot. */
  documentStructure: { errors: string[]; warnings: string[] };
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
  publishing: {
    targetPlatform: string;
    status: string;
    requestedFormats: string[];
    preparedAt: string | null;
    hasPackage: boolean;
    error: string | null;
  }[];
  marketing: { hasStrategy: boolean };
  declarations: { rightsConfirmed: boolean; rightsBasis: string | null; aiDisclosureAcknowledged: boolean } | null;
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
    { data: formattingJob },
    { data: cover },
    { data: metadata },
    { data: formatEditions },
    { data: translationJobs },
    { data: audiobookJob },
    { data: publishingJobs },
    { data: advertisingProject },
    { data: declarations },
  ] = await Promise.all([
    supabase.from("projects").select("id, book_type, status").eq("id", projectId).maybeSingle(),
    supabase.from("project_identity").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_audience").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_style").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_scope").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_platform").select("*").eq("project_id", projectId).maybeSingle(),
    supabase
      .from("chapters")
      .select("id, chapter_number, title, content, status, section_type, section_type_confidence")
      .eq("project_id", projectId)
      .order("chapter_number", { ascending: true }),
    supabase.from("quality_gate").select("*").eq("project_id", projectId).maybeSingle(),
    supabase
      .from("formatting_jobs")
      .select("status, output_formats")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("cover_department").select("concepts, final_cover_ref").eq("project_id", projectId).maybeSingle(),
    supabase.from("metadata_department").select("keywords, categories").eq("project_id", projectId).maybeSingle(),
    supabase.from("format_editions").select("format_type, status, page_count, price").eq("project_id", projectId),
    supabase.from("translation_jobs").select("target_languages, translated_outputs, status").eq("source_project_id", projectId),
    supabase.from("audiobook_jobs").select("status, voice").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from("publishing_jobs")
      .select("target_platform, status, requested_formats, prepared_at, package_ref, error")
      .eq("project_id", projectId),
    supabase.from("advertising_projects").select("id").eq("project_id", projectId).maybeSingle(),
    supabase.from("publishing_declarations").select("rights_confirmed, rights_basis, ai_disclosure_acknowledged").eq("project_id", projectId).maybeSingle(),
  ]);

  if (!project) return null;

  const chapterRows = chapters ?? [];
  const rawSections: RawSection[] = chapterRows.map((c) => ({
    id: c.id,
    title: c.title,
    content: c.content,
    chapter_number: c.chapter_number,
    section_type: c.section_type,
    section_type_confidence: c.section_type_confidence,
  }));
  const documentStructure = validateDocumentStructure(buildNormalizedDocumentModel(rawSections));
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
    ebookFormatting: { status: formattingJob?.status ?? null, outputFormats: formattingJob?.output_formats ?? [] },
    documentStructure,
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
    publishing: (publishingJobs ?? []).map((p) => ({
      targetPlatform: p.target_platform,
      status: p.status,
      requestedFormats: p.requested_formats ?? [],
      preparedAt: p.prepared_at,
      hasPackage: !!p.package_ref,
      error: p.error,
    })),
    marketing: { hasStrategy: !!advertisingProject },
    declarations: declarations
      ? {
          rightsConfirmed: declarations.rights_confirmed,
          rightsBasis: declarations.rights_basis,
          aiDisclosureAcknowledged: declarations.ai_disclosure_acknowledged,
        }
      : null,
  };
}

export type BookHealthCheck = { label: string; ok: boolean; route: string };
export type BookHealth = { checks: BookHealthCheck[]; readinessPct: number };

/**
 * Deterministic "Book Health Check" / "Publishing Readiness" computation —
 * shared by /passport (the full checklist) and the dashboard's Tasks
 * widget (which just needs each project's top failing item), so the two
 * can never drift into disagreeing about what "ready" means. Never a
 * fabricated percentage: every check reads a real column already
 * assembled by assembleBookPassport. Paperback only counts if one was
 * actually generated — it's opt-in, so a book that never wanted one isn't
 * penalized for not having it. Rights confirmation and AI-disclosure
 * acknowledgment are real author self-attestations (set from /publish,
 * see publishing_declarations) — InkFrame has no way to submit either to
 * a platform on the author's behalf, so this only tracks that the author
 * reviewed and confirmed them before publishing.
 */
export function computeBookHealth(passport: BookPassport): BookHealth {
  const projectId = passport.projectId;
  const paperbackEdition = passport.formatting.editions.find((e) => e.formatType === "paperback");
  const checks: BookHealthCheck[] = [
    { label: "Manuscript (all chapters approved)", ok: passport.chapters.total > 0 && passport.chapters.approved === passport.chapters.total, route: `/formatter?project=${projectId}` },
    { label: "Ebook formatting (DOCX/EPUB)", ok: passport.ebookFormatting.status === "complete", route: `/formatter?project=${projectId}` },
    // Real document-structure validation (lib/document-model.ts) — duplicate
    // conclusions, unresolved [AUTHOR NAME]/[PUBLISHER]/[ISBN] placeholders
    // leaked into a section's own text, leftover broken Unicode. A build
    // with any of these is never publication-ready, regardless of whether
    // ebookFormatting.status happened to say "complete".
    { label: "Document structure (chapters, front/back matter, no duplicates)", ok: passport.documentStructure.errors.length === 0, route: `/formatter?project=${projectId}` },
    // Author name is real project_identity data (never a template
    // placeholder) — but formatting only interpolates it when actually
    // set, so a missing one must block here rather than let "[AUTHOR
    // NAME]" quietly reach a publication-ready export.
    { label: "Author name set", ok: !!passport.identity?.authorName, route: `/passport?project=${projectId}` },
    { label: "Cover", ok: passport.cover.status === "done", route: `/cover?project=${projectId}` },
    { label: "Metadata", ok: passport.metadata.status === "done", route: `/metadata?project=${projectId}` },
    { label: "Quality gate scored", ok: !!passport.qualityGate?.overallReadinessScore, route: `/publish?project=${projectId}` },
    ...(paperbackEdition ? [{ label: "Paperback print cover", ok: paperbackEdition.status === "ready", route: `/cover?project=${projectId}` }] : []),
    { label: "Rights confirmed", ok: !!passport.declarations?.rightsConfirmed, route: `/publish?project=${projectId}` },
    { label: "AI-content disclosure acknowledged", ok: !!passport.declarations?.aiDisclosureAcknowledged, route: `/publish?project=${projectId}` },
  ];
  return { checks, readinessPct: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100) };
}

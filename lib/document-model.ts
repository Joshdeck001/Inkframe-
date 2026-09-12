/**
 * The Normalized Document Model — the single source of truth for what a
 * book's sections actually are, replacing the previous architecture
 * where every row in `chapters` was implicitly treated as a numbered
 * chapter. That was the real root cause of an entire class of formatter
 * bugs: front matter/an Introduction receiving "Chapter One"/"Chapter
 * Two", chapter numbers not matching a book's actual structure, and
 * duplicate conclusions — none of those were independent bugs, they were
 * all the same missing concept (section_type) surfacing in different
 * places.
 *
 * classifySection() is the ONE classifier used everywhere a section's
 * type needs to be determined: manuscript import, the AI blueprint,
 * legacy backfill during Reformat, and (for anything still unclassified
 * when a formatting run actually happens) formatting itself. There is
 * deliberately no second copy of this logic anywhere.
 *
 * buildNormalizedDocumentModel() is the ONE function that turns a
 * project's raw ordered chapter rows into the structure DOCX, EPUB, TOC,
 * running headers, and Book Health all consume identically — chapter
 * numbers are ALWAYS recomputed fresh from section_type === "chapter"
 * rows in their existing relative order, never trusted from the stored
 * chapter_number (which predates this architecture and can already be
 * wrong on existing projects).
 *
 * validateDocumentStructure() is the real structural health check this
 * project never had — see lib/book-passport.ts's computeBookHealth(),
 * which now calls it.
 */

export const SECTION_TYPES = ["front_matter", "introduction", "chapter", "conclusion", "back_matter"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export type ClassificationConfidence = "high" | "medium" | "low";

export const CURRENT_DOCUMENT_MODEL_VERSION = 1;

/**
 * The formatter's own version (lib/formatting-department.ts) — kept here,
 * not there, because that file pulls in server-only rendering libraries
 * (docx, jszip) that a client component (app/formatter/page.tsx) must
 * never import just to compare version strings. Bumped whenever the
 * rendering/structure logic changes in a way that would produce a
 * meaningfully different output for the same source content. "1.0.0"
 * marks the first version with real section-type classification — every
 * build before this existed has formatter_version: null, which is itself
 * meaningful (never classified, always worth reformatting).
 */
export const CURRENT_FORMATTER_VERSION = "1.0.0";

/**
 * Given a section's own title, decide what kind of section it is. Title-
 * based only — deliberately does not attempt content-sniffing or
 * position-based guessing beyond what's given, since a wrong guess here
 * is exactly the "destructive automatic decision" the project was asked
 * not to make. Anything that doesn't clearly match a known pattern
 * defaults to "chapter" at "low" confidence — the same thing that would
 * have happened before this existed (still numbered, still visible,
 * nothing hidden or silently reclassified away) — with confidence low
 * enough that callers know to flag it for review rather than trust it.
 */
export function classifySection(title: string | null | undefined): { sectionType: SectionType; confidence: ClassificationConfidence } {
  const t = (title ?? "").trim();

  if (/^(title\s*page|copyright(\s*page)?|dedication|table\s+of\s+contents|contents|preface|epigraph|acknowledge?ments?)\s*$/i.test(t)) {
    return { sectionType: "front_matter", confidence: "high" };
  }
  if (/^introduction\b/i.test(t)) {
    return { sectionType: "introduction", confidence: "high" };
  }
  if (/^(conclusion|final\s+thoughts|closing\s+thoughts|epilogue|afterword)\b/i.test(t)) {
    return { sectionType: "conclusion", confidence: "high" };
  }
  if (/^(about\s+the\s+author|glossary|index|appendix(es)?|bibliography|references|author'?s?\s+note)\b/i.test(t)) {
    return { sectionType: "back_matter", confidence: "high" };
  }
  if (/^(chapter|ch\.?)\s+\S/i.test(t)) {
    return { sectionType: "chapter", confidence: "high" };
  }
  if (/^\d{1,3}[.):\-—]\s*\S/.test(t) || /^part\s+\S/i.test(t)) {
    return { sectionType: "chapter", confidence: "medium" };
  }
  if (/^(prologue|foreword)\s*$/i.test(t)) {
    // Genuinely ambiguous by convention (some books number these as Chapter 1
    // equivalents, most don't) — flagged rather than guessed either way.
    return { sectionType: "front_matter", confidence: "low" };
  }

  return { sectionType: "chapter", confidence: "low" };
}

export type RawSection = {
  id: string;
  title: string | null;
  content: string;
  chapter_number: number;
  section_type: SectionType | null;
  section_type_confidence: ClassificationConfidence | null;
};

export type NormalizedSection = {
  id: string;
  title: string | null;
  content: string;
  sectionType: SectionType;
  /** 1..N for sectionType === "chapter" sections only, in reading order — null for everything else. Always recomputed, never read from storage. */
  displayNumber: number | null;
  confidence: ClassificationConfidence;
  /** True when this section's classification was guessed at low confidence and a human should confirm it — never auto-resolved silently. */
  needsReview: boolean;
};

export type NormalizedDocumentModel = {
  sections: NormalizedSection[];
};

/**
 * Sections are read in their existing chapter_number order — that
 * ordinal predates this architecture and its VALUE can already be wrong
 * on existing projects (that's the bug being fixed), but its RELATIVE
 * ORDER still reflects real manuscript sequence, since it was always
 * assigned positionally. Ordering is the one thing about the legacy
 * column still safe to trust; the displayed number never is.
 */
export function buildNormalizedDocumentModel(rawSections: RawSection[]): NormalizedDocumentModel {
  const ordered = [...rawSections].sort((a, b) => a.chapter_number - b.chapter_number);

  let nextChapterNumber = 1;
  const sections: NormalizedSection[] = ordered.map((raw) => {
    let sectionType: SectionType;
    let confidence: ClassificationConfidence;
    if (raw.section_type) {
      // Already explicitly classified at creation time (import or blueprint,
      // post-fix) — trust it; that's the whole point of classifying once at
      // the source instead of re-guessing on every formatting run.
      sectionType = raw.section_type;
      confidence = raw.section_type_confidence ?? "high";
    } else {
      const guess = classifySection(raw.title);
      sectionType = guess.sectionType;
      confidence = guess.confidence;
    }

    const displayNumber = sectionType === "chapter" ? nextChapterNumber++ : null;
    return {
      id: raw.id,
      title: raw.title,
      content: raw.content,
      sectionType,
      displayNumber,
      confidence,
      needsReview: confidence === "low",
    };
  });

  return { sections };
}

export type StructureValidationResult = {
  errors: string[];
  warnings: string[];
};

const PLACEHOLDER_PATTERN = /\[(AUTHOR NAME|PUBLISHER\s*\/\s*IMPRINT|ISBN)\]/i;
const BROKEN_UNICODE_PATTERN = /[­​-‍﻿�￾￿]/;

/**
 * Real structural health checks — the thing this project never had.
 * Previously the only numbering check anywhere (lib/quality-gate.ts's
 * continuityCheck) was informational-only and only caught gaps/ordering,
 * never duplicate sections, misclassification, or leaked placeholders.
 * Errors are blocking (a book with these should not be marked
 * publication-ready); warnings are surfaced but don't block.
 */
export function validateDocumentStructure(model: NormalizedDocumentModel): StructureValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const introductions = model.sections.filter((s) => s.sectionType === "introduction");
  if (introductions.length > 1) {
    errors.push(`${introductions.length} sections are classified as an Introduction — a book should have at most one. Review: ${introductions.map((s) => s.title).join(", ")}.`);
  }

  const conclusions = model.sections.filter((s) => s.sectionType === "conclusion");
  if (conclusions.length > 1) {
    errors.push(`${conclusions.length} sections are classified as a Conclusion — a book should have at most one. Review: ${conclusions.map((s) => s.title).join(", ")}.`);
  }

  const chapters = model.sections.filter((s) => s.sectionType === "chapter");
  const emptyChapters = chapters.filter((s) => !s.content.trim());
  if (emptyChapters.length > 0) {
    errors.push(`${emptyChapters.length} chapter(s) have no content: ${emptyChapters.map((s) => s.title ?? "Untitled").join(", ")}.`);
  }

  for (const section of model.sections) {
    if (PLACEHOLDER_PATTERN.test(`${section.title ?? ""} ${section.content}`)) {
      errors.push(`"${section.title ?? "Untitled section"}" contains an unresolved metadata placeholder ([AUTHOR NAME]/[PUBLISHER]/[ISBN]) in its own text.`);
    }
    if (BROKEN_UNICODE_PATTERN.test(`${section.title ?? ""}${section.content}`)) {
      errors.push(`"${section.title ?? "Untitled section"}" still contains a broken/invisible Unicode character — sanitization did not run or missed this row.`);
    }
  }

  const needsReview = model.sections.filter((s) => s.needsReview);
  if (needsReview.length > 0) {
    warnings.push(
      `${needsReview.length} section(s) could not be confidently classified and default to "Chapter" — review and confirm: ${needsReview.map((s) => s.title ?? "Untitled").join(", ")}.`
    );
  }

  return { errors, warnings };
}

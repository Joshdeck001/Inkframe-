// Shared shape for book_blueprint.structure (Parts → Chapters → objective/key_points/word_allocation).
// Word allocation is NOT forced equal — chapters carry different weight by design.

import { classifySection, type SectionType, type ClassificationConfidence } from "@/lib/document-model";

export type BlueprintChapter = {
  number: number;
  title: string;
  objective: string;
  key_points: string[];
  word_allocation: number;
  /** Classified via lib/document-model.ts's classifySection() right after the LLM produces the outline — see app/api/blueprint/route.ts. Absent on entries created before this existed. */
  section_type?: SectionType;
  section_type_confidence?: ClassificationConfidence;
};

/**
 * Classifies every chapter in a freshly-generated blueprint via the one
 * shared classifier (lib/document-model.ts) — called once, right after the
 * LLM produces the outline and before enforceChapterCount runs, so
 * "Introduction"/"Conclusion" entries the model included in its chapter
 * list are recognized as such instead of being renumbered and rendered
 * exactly like a real chapter later.
 */
export function classifyBlueprintStructure(structure: BlueprintStructure): BlueprintStructure {
  return {
    parts: structure.parts.map((part) => ({
      ...part,
      chapters: part.chapters.map((chapter) => {
        const { sectionType, confidence } = classifySection(chapter.title);
        return { ...chapter, section_type: sectionType, section_type_confidence: confidence };
      }),
    })),
  };
}

export type BlueprintPart = {
  title: string;
  chapters: BlueprintChapter[];
};

export type BlueprintStructure = {
  parts: BlueprintPart[];
};

export function totalWords(structure: BlueprintStructure): number {
  return structure.parts.reduce(
    (sum, part) => sum + part.chapters.reduce((s, c) => s + (c.word_allocation || 0), 0),
    0
  );
}

export function totalChapters(structure: BlueprintStructure): number {
  return structure.parts.reduce((sum, part) => sum + part.chapters.length, 0);
}

/**
 * An explicit chapter count from the author is a hard requirement, not a
 * suggestion — but an LLM instructed "exactly N chapters" in plain English
 * still doesn't reliably hit N on a large/complex structure (confirmed by
 * real generations landing anywhere from 9 to 48 against the same request).
 * Rather than keep tightening the prompt and hoping, this deterministically
 * corrects whatever the AI produced to exactly match: merges adjacent
 * chapters from the end if there are too many, splits the currently-largest
 * chapter in two if there are too few — never discards or fabricates
 * content, and always returns exactly `requiredCount` REAL chapters,
 * guaranteed.
 *
 * Operates ONLY on entries where section_type is "chapter" (or unset, for
 * structures classified before this existed) — an Introduction or
 * Conclusion the model included in its outline is left alone, never
 * merged/split/counted toward requiredCount, and never renumbered. This
 * is the actual fix for "phantom chapters": previously every entry in the
 * flat list counted toward requiredCount regardless of what it actually
 * was, so a model that produced 10 real chapters plus an Introduction and
 * a Conclusion (12 entries total) got forced down to 10 *total* entries —
 * silently eating a real chapter to make room. Now it correctly recognizes
 * 10 real chapters already meet a requiredCount of 10, and the
 * Introduction/Conclusion are left untouched, not counted twice against
 * the requirement.
 */
export function enforceChapterCount(structure: BlueprintStructure, requiredCount: number): BlueprintStructure {
  if (!Number.isFinite(requiredCount) || requiredCount < 1 || structure.parts.length === 0) return structure;

  const partSizes = structure.parts.map((p) => p.chapters.length);
  const flat: BlueprintChapter[] = structure.parts.flatMap((p) => p.chapters.map((c) => ({ ...c })));
  if (flat.length === 0) return structure;

  const isRealChapter = (c: BlueprintChapter) => !c.section_type || c.section_type === "chapter";
  const firstChapterIndex = flat.findIndex(isRealChapter);
  // Non-chapter entries before the first real chapter (front matter, an
  // Introduction) stay leading; everything else non-chapter (a Conclusion,
  // typically) stays trailing — preserves their real position without
  // needing to track every possible interleaving.
  const leading = firstChapterIndex === -1 ? [] : flat.slice(0, firstChapterIndex).filter((c) => !isRealChapter(c));
  const trailing = firstChapterIndex === -1 ? flat.filter((c) => !isRealChapter(c)) : flat.slice(firstChapterIndex).filter((c) => !isRealChapter(c));
  let chapters = flat.filter(isRealChapter);

  if (chapters.length === 0) return structure;

  // Too many: merge the last chapter into the one before it, repeatedly.
  // Combines both chapters' real content rather than dropping either.
  while (chapters.length > requiredCount && chapters.length > 1) {
    const extra = chapters.pop()!;
    const target = chapters[chapters.length - 1];
    chapters[chapters.length - 1] = {
      ...target,
      title: `${target.title} & ${extra.title}`,
      objective: `${target.objective} ${extra.objective}`,
      key_points: [...target.key_points, ...extra.key_points],
      word_allocation: (target.word_allocation || 0) + (extra.word_allocation || 0),
    };
  }

  // Too few: split the currently-largest chapter into two halves, repeatedly.
  while (chapters.length < requiredCount) {
    let biggest = 0;
    for (let i = 1; i < chapters.length; i++) {
      if ((chapters[i].word_allocation || 0) > (chapters[biggest].word_allocation || 0)) biggest = i;
    }
    const source = chapters[biggest];
    const firstHalf = Math.round((source.word_allocation || 0) / 2);
    chapters.splice(
      biggest,
      1,
      { ...source, title: `${source.title} (Part 1)`, word_allocation: firstHalf },
      { ...source, title: `${source.title} (Part 2)`, word_allocation: (source.word_allocation || 0) - firstHalf }
    );
  }

  let n = 1;
  chapters = chapters.map((c) => ({ ...c, number: n++, section_type: "chapter" as const }));

  const finalFlat = [...leading, ...chapters, ...trailing];

  // Redistribute the now-correct-length list back across the original
  // parts, proportional to each part's original share — the exact chapter
  // total is the hard requirement, not which part a chapter lands in. A
  // part a reduction leaves with nothing is dropped rather than shown empty.
  const totalOriginal = partSizes.reduce((s, n2) => s + n2, 0) || structure.parts.length;
  const newParts: BlueprintPart[] = [];
  let cursor = 0;
  structure.parts.forEach((part, i) => {
    const isLast = i === structure.parts.length - 1;
    const share = isLast
      ? finalFlat.length - cursor
      : Math.min(finalFlat.length - cursor, Math.round((partSizes[i] / totalOriginal) * finalFlat.length));
    const slice = finalFlat.slice(cursor, cursor + Math.max(0, share));
    cursor += slice.length;
    if (slice.length > 0) newParts.push({ title: part.title, chapters: slice });
  });
  if (newParts.length === 0) newParts.push({ title: structure.parts[0].title, chapters: finalFlat });

  return { parts: newParts };
}

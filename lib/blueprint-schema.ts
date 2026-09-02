// Shared shape for book_blueprint.structure (Parts → Chapters → objective/key_points/word_allocation).
// Word allocation is NOT forced equal — chapters carry different weight by design.

export type BlueprintChapter = {
  number: number;
  title: string;
  objective: string;
  key_points: string[];
  word_allocation: number;
};

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
 * content, and always returns exactly `requiredCount` chapters, guaranteed.
 */
export function enforceChapterCount(structure: BlueprintStructure, requiredCount: number): BlueprintStructure {
  if (!Number.isFinite(requiredCount) || requiredCount < 1 || structure.parts.length === 0) return structure;

  const partSizes = structure.parts.map((p) => p.chapters.length);
  const flat: BlueprintChapter[] = structure.parts.flatMap((p) => p.chapters.map((c) => ({ ...c })));
  if (flat.length === 0) return structure;

  // Too many: merge the last chapter into the one before it, repeatedly.
  // Combines both chapters' real content rather than dropping either.
  while (flat.length > requiredCount && flat.length > 1) {
    const extra = flat.pop()!;
    const target = flat[flat.length - 1];
    flat[flat.length - 1] = {
      ...target,
      title: `${target.title} & ${extra.title}`,
      objective: `${target.objective} ${extra.objective}`,
      key_points: [...target.key_points, ...extra.key_points],
      word_allocation: (target.word_allocation || 0) + (extra.word_allocation || 0),
    };
  }

  // Too few: split the currently-largest chapter into two halves, repeatedly.
  while (flat.length < requiredCount) {
    let biggest = 0;
    for (let i = 1; i < flat.length; i++) {
      if ((flat[i].word_allocation || 0) > (flat[biggest].word_allocation || 0)) biggest = i;
    }
    const source = flat[biggest];
    const firstHalf = Math.round((source.word_allocation || 0) / 2);
    flat.splice(
      biggest,
      1,
      { ...source, title: `${source.title} (Part 1)`, word_allocation: firstHalf },
      { ...source, title: `${source.title} (Part 2)`, word_allocation: (source.word_allocation || 0) - firstHalf }
    );
  }

  // Redistribute the now-correct-length chapter list back across the
  // original parts, proportional to each part's original share — the exact
  // total is the hard requirement, not which part a chapter lands in. A
  // part a reduction leaves with nothing is dropped rather than shown empty.
  const totalOriginal = partSizes.reduce((s, n) => s + n, 0) || structure.parts.length;
  const newParts: BlueprintPart[] = [];
  let cursor = 0;
  structure.parts.forEach((part, i) => {
    const isLast = i === structure.parts.length - 1;
    const share = isLast
      ? flat.length - cursor
      : Math.min(flat.length - cursor, Math.round((partSizes[i] / totalOriginal) * flat.length));
    const slice = flat.slice(cursor, cursor + Math.max(0, share));
    cursor += slice.length;
    if (slice.length > 0) newParts.push({ title: part.title, chapters: slice });
  });
  if (newParts.length === 0) newParts.push({ title: structure.parts[0].title, chapters: flat });

  let n = 1;
  for (const part of newParts) {
    for (const chapter of part.chapters) {
      chapter.number = n++;
    }
  }

  return { parts: newParts };
}

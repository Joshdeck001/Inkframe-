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

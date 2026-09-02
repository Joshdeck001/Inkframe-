/**
 * Shared book-type/trim-size logic used by both the Writing Agent (what
 * structure to instruct the AI to write) and the Formatting Department
 * (how to render that structure, and what page size to use). Kept in one
 * place so the two stay in lockstep — a project's book_type always gets
 * the same treatment end to end, chapter to chapter, for the whole book.
 */

const STRUCTURED_BOOK_TYPES = new Set(["Nonfiction", "Self-help", "Educational", "Technical/Professional"]);

/**
 * Structured (guide/workbook/technical) book types benefit from real
 * headings, lists, and code blocks — the Writing Agent is told to use
 * lightweight Markdown for these, and the Formatting Department parses it
 * into real docx elements. Everything else (fiction, memoir, children's,
 * etc.) stays plain narrative prose, exactly as before this existed.
 */
export function isStructuredBookType(bookType: string | null | undefined): boolean {
  return !!bookType && STRUCTURED_BOOK_TYPES.has(bookType);
}

const TRIM_SIZES: Record<string, { widthIn: number; heightIn: number }> = {
  "5x8": { widthIn: 5, heightIn: 8 },
  "5.5x8.5": { widthIn: 5.5, heightIn: 8.5 },
  "6x9": { widthIn: 6, heightIn: 9 },
  "8.5x11": { widthIn: 8.5, heightIn: 11 },
};

/** Falls back to 6x9 (the standard KDP paperback size) for an unset/unrecognized value. */
export function trimSizeInches(trimSize: string | null | undefined): { widthIn: number; heightIn: number } {
  return (trimSize && TRIM_SIZES[trimSize]) || TRIM_SIZES["6x9"];
}

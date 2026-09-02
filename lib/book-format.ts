import { AlignmentType, convertInchesToTwip } from "docx";

/**
 * The Book Design Profile system — the data-driven core the rest of the
 * Formatting Department (lib/formatting-department.ts) and the Writing
 * Agent (lib/writing-agent.ts) plug into. One family, decided once per
 * project from its fixed book_type, applied identically to every chapter
 * from the first page to the last — never a per-book special case, never
 * switching styles partway through. Deliberately keeps the family count
 * to what the schema's existing book_type values actually support
 * (fiction / children's / self-help / technical-nonfiction) rather than
 * fabricating finer sub-genre distinctions (romance vs. thriller, etc.)
 * that would need a real classification input the app doesn't collect.
 */

export type BookDesignFamily = "fiction" | "childrens" | "self_help" | "technical";

const FAMILY_BY_BOOK_TYPE: Record<string, BookDesignFamily> = {
  "Children's": "childrens",
  "Self-help": "self_help",
  Nonfiction: "technical",
  Educational: "technical",
  "Technical/Professional": "technical",
};

export function getDesignFamily(bookType: string | null | undefined): BookDesignFamily {
  return (bookType && FAMILY_BY_BOOK_TYPE[bookType]) || "fiction";
}

/**
 * Structured families (real headings/lists/tables/callouts, parsed from
 * the Writing Agent's lightweight Markdown) vs. fiction's plain narrative
 * prose. Kept as its own check (not just `family !== "fiction"`) so the
 * two systems can diverge later without silently coupling them.
 */
export function isStructuredBookType(bookType: string | null | undefined): boolean {
  return getDesignFamily(bookType) !== "fiction";
}

export type BookDesignProfile = {
  family: BookDesignFamily;
  bodyFont: string;
  headingFont: string;
  bodySize: number; // half-points
  bodyAlignment: (typeof AlignmentType)[keyof typeof AlignmentType];
  firstLineIndent: boolean;
  paragraphSpacingAfter: number; // twips
  chapterHeadingSize: number; // half-points
  chapterTitleItalic: boolean;
  calloutsEnabled: boolean;
};

const PROFILES: Record<BookDesignFamily, BookDesignProfile> = {
  fiction: {
    family: "fiction",
    bodyFont: "Times New Roman",
    headingFont: "Times New Roman",
    bodySize: 24,
    bodyAlignment: AlignmentType.JUSTIFIED,
    firstLineIndent: true,
    paragraphSpacingAfter: 0,
    chapterHeadingSize: 28,
    chapterTitleItalic: true,
    calloutsEnabled: false,
  },
  childrens: {
    family: "childrens",
    bodyFont: "Georgia",
    headingFont: "Georgia",
    bodySize: 28,
    bodyAlignment: AlignmentType.LEFT,
    firstLineIndent: false,
    paragraphSpacingAfter: 300,
    chapterHeadingSize: 36,
    chapterTitleItalic: false,
    calloutsEnabled: false,
  },
  self_help: {
    family: "self_help",
    bodyFont: "Times New Roman",
    headingFont: "Arial",
    bodySize: 24,
    bodyAlignment: AlignmentType.LEFT,
    firstLineIndent: false,
    paragraphSpacingAfter: 200,
    chapterHeadingSize: 28,
    chapterTitleItalic: false,
    calloutsEnabled: true,
  },
  technical: {
    family: "technical",
    bodyFont: "Times New Roman",
    headingFont: "Arial",
    bodySize: 22,
    bodyAlignment: AlignmentType.LEFT,
    firstLineIndent: false,
    paragraphSpacingAfter: 180,
    chapterHeadingSize: 26,
    chapterTitleItalic: false,
    calloutsEnabled: true,
  },
};

export function getDesignProfile(bookType: string | null | undefined): BookDesignProfile {
  return PROFILES[getDesignFamily(bookType)];
}

/**
 * Extra guidance folded into the Writing Agent's system prompt for
 * structured families, on top of the shared Markdown-structure
 * instructions in lib/writing-agent.ts — callouts/tables are opt-in
 * per family so a self-help book doesn't read like a spec sheet and a
 * technical guide doesn't read like a motivational pamphlet.
 */
export function writingGuidanceFor(family: BookDesignFamily): string {
  if (family === "self_help") {
    return (
      "This is a self-help/personal-development book. Where it genuinely fits the content, use a callout " +
      "line on its own starting with '> KEY TAKEAWAY:', '> TIP:', or '> ACTION STEP:' followed by the text " +
      "— for a core insight, a practical tip, or a concrete step the reader should take. Don't force one " +
      "into every section; only where it adds real value."
    );
  }
  if (family === "technical") {
    return (
      "This is a technical/educational/professional reference. Where the content genuinely calls for it, " +
      "use a callout line starting with '> NOTE:', '> WARNING:', '> IMPORTANT:', or '> DEFINITION:' " +
      "followed by the text, and use a Markdown table (header row, a '|---|---|' separator row, then data " +
      "rows) for any genuinely tabular information. Don't force either into content that reads better as " +
      "plain prose or a list."
    );
  }
  return "";
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

export const PAGE_MARGIN_IN = 0.75;

/** Usable text-block width in twips — page width minus both side margins. Same across the whole book. */
export function contentWidthTwips(trimSize: string | null | undefined): number {
  const { widthIn } = trimSizeInches(trimSize);
  return convertInchesToTwip(widthIn - PAGE_MARGIN_IN * 2);
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** "Chapter One", "Chapter Twenty-Three" — spelled out, matching real published-book convention, not a bare numeral. Shared by both the DOCX and EPUB builders so chapter headings read identically in either format. */
export function numberToWords(n: number): string {
  if (n <= 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10].toLowerCase()}` : "");
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` ${numberToWords(rest)}` : ""}`;
}

/**
 * Manuscript text sanitization — the missing layer between "text
 * extracted from an uploaded file" and "text stored/rendered as a real
 * chapter." Root cause of the "Self￾Esteem" class of bug: Word documents
 * routinely embed soft (discretionary) hyphens (U+00AD) at syllable
 * breaks, invisible in Word itself but rendered as a stray glyph by other
 * consumers. mammoth (the DOCX→HTML converter used at import) preserves
 * these literally; nothing downstream ever stripped them before this.
 *
 * Deliberately narrow: only removes/normalizes characters that cannot be
 * a deliberate authorial choice (soft hyphens, zero-width characters, the
 * Unicode replacement character, byte-order marks). Never touches em
 * dashes, en dashes, curly quotes, apostrophes, accented characters, or
 * any non-English text — those are legitimate content, not artifacts.
 * Applied at manuscript ingestion (lib/manuscript-import.ts) AND
 * defensively again immediately before final export (lib/formatting-
 * department.ts, lib/epub-builder.ts) per the spec's "run at ingestion,
 * keep a defensive pass before export too" requirement — records
 * imported before this existed still get cleaned up the next time they're
 * formatted, without needing a separate one-time migration script.
 */

// A soft hyphen marks an optional hyphenation point — when it survives
// into plain text outside a live word-processor's line-breaking engine,
// the honest rendering is a real hyphen, not an invisible break that
// happens to show as a glyph in whatever's currently displaying it.
const SOFT_HYPHEN = /­/g;

// Zero-width characters and byte-order marks carry no visible meaning in
// running prose and only ever reach text as artifacts of how it was
// encoded/copied — safe to remove outright.
const ZERO_WIDTH_AND_BOM = /[​-‍﻿]/g;

// The Unicode replacement character marks data that was already
// unrecoverable before it reached us (a genuine encoding failure
// upstream) — there is no correct character to substitute, so it's
// removed rather than shipped as a visible "broken" glyph in a published
// book.
const REPLACEMENT_CHAR = /�/g;

// Noncharacters (U+FFFE/U+FFFF and the U+FDD0–U+FDEF block) are reserved
// by the Unicode standard to never represent real text.
const NONCHARACTERS = /[￾￿﷐-﷯]/g;

export function sanitizeManuscriptText(text: string): string {
  if (!text) return text;
  return text
    .replace(SOFT_HYPHEN, "-")
    .replace(ZERO_WIDTH_AND_BOM, "")
    .replace(REPLACEMENT_CHAR, "")
    .replace(NONCHARACTERS, "")
    .normalize("NFC");
}

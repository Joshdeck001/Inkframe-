/**
 * Paperback print-cover dimension math — spine width and full-wrap
 * (front + spine + back) size, in inches. Cross-checked against multiple
 * independent published breakdowns of Amazon KDP's own formula (KDP's own
 * help page is unreachable from this sandbox's network egress, so this
 * isn't verified against Amazon's primary documentation — if KDP's actual
 * numbers ever differ, PAPER_THICKNESS_IN below is the one place to fix).
 *
 * page_count must be a REAL number, not an estimate: nothing in this app
 * renders/paginates a manuscript (no PDF renderer exists — see the
 * README's "Why PDF isn't built (yet)"), and format_editions.page_count's
 * own schema comment says "must come from the final formatted manuscript,
 * never estimated". So this deliberately takes page_count as a value the
 * AUTHOR reads off their own exported DOCX opened in Word (which does
 * paginate accurately) rather than computing/guessing one from word count.
 */

export type PaperType = "white" | "cream" | "color";

// Inches of thickness per page, by paper stock.
export const PAPER_THICKNESS_IN: Record<PaperType, number> = {
  white: 0.002252,
  cream: 0.0025,
  color: 0.002347,
};

const COVER_STOCK_ALLOWANCE_IN = 0.06; // added to raw page-thickness to get spine width
const BLEED_IN = 0.125; // each outer edge
const MIN_PAGES_FOR_SPINE_TEXT = 100; // KDP will not allow spine text below this

export type PaperbackCoverSpec = {
  spineWidthIn: number;
  fullWrapWidthIn: number;
  fullWrapHeightIn: number;
  spineTextAllowed: boolean;
};

export function calculatePaperbackCoverSpec(opts: {
  trimWidthIn: number;
  trimHeightIn: number;
  pageCount: number;
  paperType: PaperType;
}): PaperbackCoverSpec {
  const spineWidthIn = opts.pageCount * PAPER_THICKNESS_IN[opts.paperType] + COVER_STOCK_ALLOWANCE_IN;
  return {
    spineWidthIn,
    fullWrapWidthIn: opts.trimWidthIn * 2 + spineWidthIn + BLEED_IN * 2,
    fullWrapHeightIn: opts.trimHeightIn + BLEED_IN * 2,
    spineTextAllowed: opts.pageCount >= MIN_PAGES_FOR_SPINE_TEXT,
  };
}

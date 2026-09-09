import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";

const PT_PER_IN = 72;
const BLEED_IN = 0.125;
// A widely-cited convention for keeping text clear of the trim/fold lines —
// not verified against any single platform's current primary template
// (KDP's own spec page is unreachable from this sandbox), so this is drawn
// as a visual guide the author should double-check, not a guarantee.
const SAFE_MARGIN_IN = 0.25;

export type PrintCoverInput = {
  fullWrapWidthIn: number;
  fullWrapHeightIn: number;
  spineWidthIn: number;
  trimWidthIn: number;
  trimHeightIn: number;
  spineTextAllowed: boolean;
  frontCoverImageBytes: Buffer;
  frontCoverImageType: "jpg" | "png";
};

/**
 * Builds one PDF page at the exact computed full-wrap size (back | spine |
 * front, left to right, the standard KDP/print-on-demand layout), with the
 * real ebook cover image placed into the front panel at its true trim
 * size. The back cover and spine are NOT generated content — there's no
 * back-cover copy or separate spine artwork anywhere in this app to draw
 * from — they're rendered as a labeled, correctly-dimensioned template
 * (fill color + safe-area guide + placeholder text) so the one thing this
 * genuinely gets right (precise print dimensions) is real, and the one
 * thing it can't do (back-cover design) is never faked as done.
 */
export async function buildPaperbackCoverPdf(input: PrintCoverInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const pageWidthPt = input.fullWrapWidthIn * PT_PER_IN;
  const pageHeightPt = input.fullWrapHeightIn * PT_PER_IN;
  const page = doc.addPage([pageWidthPt, pageHeightPt]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const bleedPt = BLEED_IN * PT_PER_IN;
  const panelHeightPt = input.trimHeightIn * PT_PER_IN;
  const backPanelX = bleedPt;
  const backPanelWidthPt = input.trimWidthIn * PT_PER_IN;
  const spinePanelX = backPanelX + backPanelWidthPt;
  const spinePanelWidthPt = input.spineWidthIn * PT_PER_IN;
  const frontPanelX = spinePanelX + spinePanelWidthPt;
  const frontPanelWidthPt = input.trimWidthIn * PT_PER_IN;

  page.drawRectangle({ x: 0, y: 0, width: pageWidthPt, height: pageHeightPt, color: rgb(0.95, 0.95, 0.95) });

  const image =
    input.frontCoverImageType === "jpg" ? await doc.embedJpg(input.frontCoverImageBytes) : await doc.embedPng(input.frontCoverImageBytes);
  page.drawImage(image, { x: frontPanelX, y: bleedPt, width: frontPanelWidthPt, height: panelHeightPt });

  const safeInsetPt = SAFE_MARGIN_IN * PT_PER_IN;
  const drawSafeArea = (x: number, width: number) =>
    page.drawRectangle({
      x: x + safeInsetPt,
      y: bleedPt + safeInsetPt,
      width: width - safeInsetPt * 2,
      height: panelHeightPt - safeInsetPt * 2,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 0.5,
      borderDashArray: [4, 4],
    });
  drawSafeArea(backPanelX, backPanelWidthPt);
  drawSafeArea(spinePanelX, spinePanelWidthPt);
  drawSafeArea(frontPanelX, frontPanelWidthPt);

  page.drawText("BACK COVER — add your own cover copy/art (not generated here)", {
    x: backPanelX + safeInsetPt + 4,
    y: bleedPt + panelHeightPt - safeInsetPt - 14,
    size: 8,
    font,
    color: rgb(0.3, 0.3, 0.3),
    maxWidth: backPanelWidthPt - safeInsetPt * 2 - 8,
  });

  if (spinePanelWidthPt > 6) {
    page.drawText(input.spineTextAllowed ? "SPINE" : "Spine too thin for text", {
      x: spinePanelX + 2,
      y: bleedPt + panelHeightPt / 2,
      size: Math.min(7, spinePanelWidthPt - 2),
      font,
      color: rgb(0.3, 0.3, 0.3),
      rotate: degrees(90),
    });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/**
 * Structured cover preflight (spec section 19) — real, deterministic
 * checks over data the Cover Designer already has, never a second
 * "cover health" score alongside computeBookHealth() (lib/book-
 * passport.ts already tracks "Cover" and "Paperback print cover" as
 * real Book Health checks; this is the finer-grained validation shown
 * inside Cover Designer itself before export, reading the same
 * underlying facts — one computation, two levels of detail, not two
 * competing systems).
 */

export type CoverCheckStatus = "pass" | "warning" | "error";
export type CoverCheck = { id: string; label: string; status: CoverCheckStatus; message: string };
export type CoverValidationResult = { status: CoverCheckStatus; checks: CoverCheck[] };

const MIN_SAFE_SPINE_IN = 0.0625; // ~4.5pt — real text won't render legibly thinner than this

export function validateCover(input: {
  hasSelectedArtwork: boolean;
  title: string | null;
  authorName: string | null;
  paperbackRequested: boolean;
  paperbackEditionStatus: string | null;
  spineWidthIn: number | null;
  spineTextAllowed: boolean | null;
  needsRecalculation: boolean;
  printPdfGenerated: boolean;
}): CoverValidationResult {
  const checks: CoverCheck[] = [];

  checks.push(
    input.hasSelectedArtwork
      ? { id: "artwork", label: "Artwork selected", status: "pass", message: "A cover image is set." }
      : { id: "artwork", label: "Artwork selected", status: "error", message: "No cover artwork has been generated, uploaded, or selected yet." }
  );

  checks.push(
    input.title && input.title !== "Untitled Project"
      ? { id: "title", label: "Title present", status: "pass", message: "Title is set." }
      : { id: "title", label: "Title present", status: "error", message: "No working title is set for this book." }
  );

  checks.push(
    input.authorName
      ? { id: "author", label: "Author present", status: "pass", message: "Author name is set." }
      : { id: "author", label: "Author present", status: "warning", message: "No author/pen name is set yet — add one before final export." }
  );

  if (input.paperbackRequested) {
    if (input.paperbackEditionStatus === "ready") {
      checks.push({ id: "paperback_dimensions", label: "Paperback dimensions calculated", status: "pass", message: "Spine and full-wrap dimensions are calculated from real trim size and page count." });
    } else {
      checks.push({ id: "paperback_dimensions", label: "Paperback dimensions calculated", status: "error", message: "Paperback cover dimensions haven't been generated yet — enter page count and paper type in Cover Studio." });
    }

    if (input.needsRecalculation) {
      checks.push({ id: "recalculation", label: "Dimensions up to date", status: "error", message: "The page count changed since this cover was calculated — regenerate the paperback cover before export." });
    }

    if (input.spineWidthIn != null) {
      if (input.spineWidthIn < MIN_SAFE_SPINE_IN) {
        checks.push({ id: "spine_width", label: "Spine width", status: "warning", message: `Spine is only ${input.spineWidthIn.toFixed(3)}in — likely too thin for legible spine text.` });
      } else if (input.spineTextAllowed === false) {
        checks.push({ id: "spine_width", label: "Spine width", status: "warning", message: "This book is under 100 pages — KDP does not allow spine text at this page count." });
      } else {
        checks.push({ id: "spine_width", label: "Spine width", status: "pass", message: `Spine is ${input.spineWidthIn.toFixed(3)}in — spine text fits.` });
      }
    }

    checks.push(
      input.printPdfGenerated
        ? { id: "print_pdf", label: "Print-ready PDF generated", status: "pass", message: "A print-ready PDF exists at the calculated dimensions." }
        : { id: "print_pdf", label: "Print-ready PDF generated", status: "error", message: "No print-ready PDF has been generated yet." }
    );
  }

  const status: CoverCheckStatus = checks.some((c) => c.status === "error") ? "error" : checks.some((c) => c.status === "warning") ? "warning" : "pass";
  return { status, checks };
}

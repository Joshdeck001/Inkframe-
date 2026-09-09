import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { calculatePaperbackCoverSpec, type PaperType } from "@/lib/print-cover";
import { buildPaperbackCoverPdf } from "@/lib/print-cover-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAPER_TYPES: PaperType[] = ["white", "cream", "color"];
const TRIM_SIZES: Record<string, { widthIn: number; heightIn: number }> = {
  "5x8": { widthIn: 5, heightIn: 8 },
  "5.5x8.5": { widthIn: 5.5, heightIn: 8.5 },
  "6x9": { widthIn: 6, heightIn: 9 },
  "8.5x11": { widthIn: 8.5, heightIn: 11 },
};

/**
 * Calculates the real spine/full-wrap dimensions and generates a
 * print-ready paperback cover PDF at that exact size, with the existing
 * ebook cover art placed into the front panel. page_count is required as
 * user input rather than computed here — this app has no PDF renderer to
 * actually paginate a manuscript, and format_editions.page_count's own
 * schema comment says it must come from the real formatted manuscript,
 * never an estimate. The author reads the real number off their exported
 * DOCX opened in Word/Google Docs, which does paginate accurately.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { project_id, page_count, paper_type } = await request.json();
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const pageCount = Number(page_count);
  if (!Number.isInteger(pageCount) || pageCount < 24) {
    return NextResponse.json({ error: "page_count must be a real whole number (read it off your exported DOCX in Word) — at least 24." }, { status: 400 });
  }
  if (!PAPER_TYPES.includes(paper_type)) {
    return NextResponse.json({ error: `paper_type must be one of: ${PAPER_TYPES.join(", ")}` }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const [{ data: scope }, { data: cover }] = await Promise.all([
    supabase.from("project_scope").select("trim_size").eq("project_id", project_id).maybeSingle(),
    supabase.from("cover_department").select("final_cover_ref").eq("project_id", project_id).maybeSingle(),
  ]);
  if (!scope) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!cover?.final_cover_ref) {
    return NextResponse.json({ error: "Generate and choose an ebook cover first — the print cover reuses that artwork for the front panel." }, { status: 400 });
  }

  const trim = TRIM_SIZES[scope.trim_size ?? "6x9"] ?? TRIM_SIZES["6x9"];
  const spec = calculatePaperbackCoverSpec({ trimWidthIn: trim.widthIn, trimHeightIn: trim.heightIn, pageCount, paperType: paper_type });

  let imageBytes: Buffer;
  let imageType: "jpg" | "png";
  try {
    const res = await fetch(cover.final_cover_ref);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    imageBytes = Buffer.from(await res.arrayBuffer());
    imageType = cover.final_cover_ref.split(".").pop()?.split("?")[0] === "png" ? "png" : "jpg";
  } catch (e) {
    return NextResponse.json({ error: `Could not fetch the ebook cover artwork: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const pdfBuffer = await buildPaperbackCoverPdf({
    fullWrapWidthIn: spec.fullWrapWidthIn,
    fullWrapHeightIn: spec.fullWrapHeightIn,
    spineWidthIn: spec.spineWidthIn,
    trimWidthIn: trim.widthIn,
    trimHeightIn: trim.heightIn,
    spineTextAllowed: spec.spineTextAllowed,
    frontCoverImageBytes: imageBytes,
    frontCoverImageType: imageType,
  });

  const { data: edition, error: editionError } = await supabase
    .from("format_editions")
    .upsert({ project_id, format_type: "paperback", page_count: pageCount, status: "ready" }, { onConflict: "project_id,format_type" })
    .select("id")
    .single();
  if (editionError || !edition) return NextResponse.json({ error: editionError?.message || "Could not save the format edition." }, { status: 500 });

  const { error: specError } = await supabase.from("cover_specs").insert({
    format_edition_id: edition.id,
    trim_width: trim.widthIn,
    trim_height: trim.heightIn,
    unit: "inches",
    page_count: pageCount,
    binding: "paperback",
    paper_type: paper_type,
    bleed_required: true,
    calculated_spine_width: spec.spineWidthIn,
    calculated_full_wrap_width: spec.fullWrapWidthIn,
    calculated_full_wrap_height: spec.fullWrapHeightIn,
    safe_area: { margin_in: 0.25, note: "Visual guide only — not verified against any single platform's current primary template." },
    needs_recalculation: false,
  });
  if (specError) return NextResponse.json({ error: specError.message }, { status: 500 });

  const path = `${user.id}/${project_id}/paperback-cover.pdf`;
  const service = createServiceClient();
  const { error: uploadError } = await service.storage.from("exports").upload(path, pdfBuffer, { contentType: "application/pdf", upsert: true });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  await supabase.from("export_records").insert({ project_id, export_type: "cover", file_ref: path });

  const { data: signed, error: signError } = await service.storage.from("exports").createSignedUrl(path, 60);
  if (signError || !signed) return NextResponse.json({ error: signError?.message || "Could not create a download link." }, { status: 500 });

  return NextResponse.json({
    url: signed.signedUrl,
    spine_width_in: Math.round(spec.spineWidthIn * 1000) / 1000,
    full_wrap_width_in: Math.round(spec.fullWrapWidthIn * 1000) / 1000,
    full_wrap_height_in: Math.round(spec.fullWrapHeightIn * 1000) / 1000,
    spine_text_allowed: spec.spineTextAllowed,
  });
});

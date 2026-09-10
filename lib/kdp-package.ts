import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import type { BookPassport } from "@/lib/book-passport";
import type { FormatType, PreflightResult } from "@/lib/kdp-preparation";

export type KdpDeclarations = { rightsBasis: string | null; rightsConfirmed: boolean; aiDisclosureAcknowledged: boolean };

/**
 * Builds the "KDP Ready Package" — the complete, structured handoff
 * bundle a user needs when no official KDP draft-creation API exists to
 * do this step for them (see README's "KDP integration" section: it
 * doesn't). Reuses the exact same zip-assembly pattern as
 * /api/production-package (JSZip + download-from-the-private-`exports`-
 * bucket) rather than a second export engine — this is a differently
 * organized bundle for a specific purpose (KDP upload), not a different
 * mechanism.
 *
 * Only ever includes real, already-generated assets. A requested format
 * that isn't ready yet (or, for hardcover, can never be ready with
 * InkFrame's current capabilities) is never faked into the package —
 * it's named in preflight-summary.txt instead, so the author knows
 * exactly what still needs manual work.
 */
export async function buildKdpPackageZip(
  supabase: SupabaseClient,
  passport: BookPassport,
  userId: string,
  prices: Record<FormatType, string>,
  declarations: KdpDeclarations,
  preflight: PreflightResult,
  targetPlatform: string
): Promise<{ buffer: Buffer; included: string[] }> {
  const zip = new JSZip();
  const included: string[] = [];
  const projectId = passport.projectId;

  // 01-Manuscript
  const { data: formattingJob } = await supabase
    .from("formatting_jobs")
    .select("output_files")
    .eq("project_id", projectId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const manuscriptFolder = zip.folder("01-Manuscript")!;
  for (const path of formattingJob?.output_files ?? []) {
    const { data: blob } = await supabase.storage.from("exports").download(path);
    if (!blob) continue;
    const ext = path.split(".").pop() || "bin";
    const filename = `manuscript.${ext}`;
    manuscriptFolder.file(filename, await blob.arrayBuffer());
    included.push(`01-Manuscript/${filename}`);
  }

  // 02-Covers
  const coversFolder = zip.folder("02-Covers")!;
  if (passport.cover.finalCoverRef) {
    try {
      const res = await fetch(passport.cover.finalCoverRef);
      if (res.ok) {
        const ext = passport.cover.finalCoverRef.split(".").pop()?.split("?")[0] || "jpg";
        coversFolder.file(`ebook-cover.${ext}`, await res.arrayBuffer());
        included.push(`02-Covers/ebook-cover.${ext}`);
      }
    } catch {
      // Left out rather than faked — same convention as production-package.
    }
  }
  const paperbackEdition = passport.formatting.editions.find((e) => e.formatType === "paperback");
  if (paperbackEdition?.status === "ready") {
    const coverPath = `${userId}/${projectId}/paperback-cover.pdf`;
    const { data: blob } = await supabase.storage.from("exports").download(coverPath);
    if (blob) {
      coversFolder.file("paperback-full-cover.pdf", await blob.arrayBuffer());
      included.push("02-Covers/paperback-full-cover.pdf");
    }
  }

  // 03-Interior — honestly empty until InkFrame has a real interior-PDF renderer.
  zip
    .folder("03-Interior")!
    .file(
      "NOTE.txt",
      "InkFrame doesn't generate a print-ready paperback/hardcover interior PDF yet. Export the manuscript " +
        "from 01-Manuscript and lay out the interior yourself (or with a formatting tool) before uploading it " +
        "to KDP.\n"
    );
  included.push("03-Interior/NOTE.txt");

  // 04-Metadata
  const { data: metadataRow } = await supabase
    .from("metadata_department")
    .select("description_long, description_short, keywords, categories, bisac_codes")
    .eq("project_id", projectId)
    .maybeSingle();
  const metadataFolder = zip.folder("04-Metadata")!;
  metadataFolder.file(
    "metadata.json",
    JSON.stringify(
      {
        title: passport.identity?.workingTitle ?? null,
        subtitle: passport.identity?.subtitle ?? null,
        author: passport.identity?.authorName ?? null,
        pen_name: passport.identity?.penName ?? null,
        series_name: passport.identity?.seriesName ?? null,
        series_number: passport.identity?.seriesNumber ?? null,
        language: passport.identity?.language ?? null,
        keywords: metadataRow?.keywords ?? [],
        categories: metadataRow?.categories ?? [],
        bisac_codes: metadataRow?.bisac_codes ?? [],
        rights_basis: declarations.rightsBasis,
        rights_confirmed: declarations.rightsConfirmed,
        ai_content_disclosure_acknowledged: declarations.aiDisclosureAcknowledged,
      },
      null,
      2
    )
  );
  metadataFolder.file("description.txt", metadataRow?.description_long || metadataRow?.description_short || "");
  included.push("04-Metadata/metadata.json", "04-Metadata/description.txt");

  // 05-Pricing
  zip.folder("05-Pricing")!.file(
    "pricing.json",
    JSON.stringify(
      {
        currency: "USD",
        ebook: prices.ebook.trim() ? Number(prices.ebook) : null,
        paperback: prices.paperback.trim() ? Number(prices.paperback) : null,
        hardcover: prices.hardcover.trim() ? Number(prices.hardcover) : null,
      },
      null,
      2
    )
  );
  included.push("05-Pricing/pricing.json");

  // 06-Preflight
  const preflightFolder = zip.folder("06-Preflight")!;
  preflightFolder.file("preflight.json", JSON.stringify(preflight, null, 2));
  const summaryLines = [
    `KDP preparation summary for "${passport.identity?.workingTitle ?? "Untitled Project"}"`,
    `Target platform: ${targetPlatform}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    `Book Health: ${preflight.readinessPct}% (InkFrame's internal assessment — not a guarantee of platform acceptance)`,
    "",
    "Formats:",
    ...preflight.formats
      .filter((f) => f.requested)
      .map((f) => {
        const status = !f.supported ? "not supported yet" : f.ready ? "ready" : "needs attention";
        const detail = [...f.blockers, ...f.notes].join(" ");
        return `- ${f.format}: ${status}${detail ? ` — ${detail}` : ""}`;
      }),
    "",
    "This package was prepared by InkFrame for you to review and upload yourself. InkFrame never logs into or " +
      "submits directly to your KDP account — you always make the final upload and publish decision yourself, " +
      "on your own platform login.",
  ];
  preflightFolder.file("preflight-summary.txt", summaryLines.join("\n"));
  included.push("06-Preflight/preflight.json", "06-Preflight/preflight-summary.txt");

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        inkframe_project_id: projectId,
        title: passport.identity?.workingTitle ?? null,
        target_platform: targetPlatform,
        included_files: included,
        note: "Prepared by InkFrame for the author to review and upload. This package was not submitted anywhere — InkFrame never publishes automatically.",
      },
      null,
      2
    )
  );

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return { buffer, included };
}

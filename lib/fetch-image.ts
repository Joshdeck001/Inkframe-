export type LoadedImage = { buffer: Buffer; type: "png" | "jpg" | "gif" | "bmp"; mimeType: string };

/**
 * Real cover/interior artwork lives in public storage buckets as plain
 * URLs (cover_department.concepts[].image_ref, image_placements.file_ref)
 * — both the DOCX and EPUB builders need actual bytes, not a URL, so this
 * fetches them at export time. Shared so both formats agree on what
 * counts as a supported image type. Best-effort: a fetch failure just
 * means that one image is skipped, never a reason to fail the whole
 * manuscript export.
 */
export async function fetchImage(url: string): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const type: LoadedImage["type"] = contentType.includes("jpeg")
      ? "jpg"
      : contentType.includes("gif")
        ? "gif"
        : contentType.includes("bmp")
          ? "bmp"
          : "png";
    const mimeType = contentType.split(";")[0].trim() || `image/${type === "jpg" ? "jpeg" : type}`;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, type, mimeType };
  } catch {
    return null;
  }
}

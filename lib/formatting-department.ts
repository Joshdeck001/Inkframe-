import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  PageBreak,
  ImageRun,
  AlignmentType,
  Footer,
  PageNumber,
  convertInchesToTwip,
} from "docx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeQualityGate } from "@/lib/quality-gate";
import { getPausedProjectIds } from "@/lib/production-paused";

type DocxImageType = "jpg" | "png" | "gif" | "bmp";

/**
 * Real cover/interior artwork lives in public storage buckets as plain
 * URLs (cover_department.concepts[].image_ref, image_placements.file_ref)
 * — docx's ImageRun needs actual bytes, not a URL, so this fetches them at
 * export time. Best-effort: a fetch failure just means that one image is
 * skipped, never a reason to fail the whole manuscript export.
 */
async function fetchImage(url: string): Promise<{ buffer: Buffer; type: DocxImageType } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const type: DocxImageType = contentType.includes("jpeg")
      ? "jpg"
      : contentType.includes("gif")
        ? "gif"
        : contentType.includes("bmp")
          ? "bmp"
          : "png";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, type };
  } catch {
    return null;
  }
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function numberToWords(n: number): string {
  if (n <= 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10].toLowerCase()}` : "");
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` ${numberToWords(rest)}` : ""}`;
}

const BODY_FONT = "Times New Roman";
const FIRST_LINE_INDENT = convertInchesToTwip(0.5);

/**
 * Assembles the approved manuscript into a real, professionally formatted
 * DOCX (6x9in trim — a standard KDP paperback size — serif body text,
 * justified with first-line indents, centered chapter headings, and page
 * numbers) and stores it in the private `exports` bucket. EPUB/PDF aren't
 * implemented yet — output_formats only ever lists what was actually
 * produced, never a format that doesn't exist as a real file.
 */
export async function runFormattingDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const pausedProjectIds = await getPausedProjectIds(supabase);

  let projectQuery = supabase.from("projects").select("id, user_id").eq("status", "FORMATTING");
  if (pausedProjectIds.length > 0) {
    projectQuery = projectQuery.not("id", "in", `(${pausedProjectIds.join(",")})`);
  }
  const { data: project, error: projectQueryError } = await projectQuery
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);
  if (!project) return { processed: false, detail: "No projects awaiting formatting." };

  const [{ data: identity }, { data: chapters }, { data: cover }, { data: placements }] = await Promise.all([
    supabase.from("project_identity").select("*").eq("project_id", project.id).single(),
    supabase
      .from("chapters")
      .select("id, chapter_number, title, content")
      .eq("project_id", project.id)
      .order("chapter_number", { ascending: true }),
    supabase.from("cover_department").select("concepts, final_cover_ref").eq("project_id", project.id).maybeSingle(),
    supabase.from("image_placements").select("chapter_id, file_ref").eq("project_id", project.id).eq("status", "generated"),
  ]);

  const coverConcepts = (cover?.concepts as { image_ref: string | null; status: string }[] | undefined) ?? [];
  const coverImageUrl = cover?.final_cover_ref || coverConcepts.find((c) => c.status === "generated" && c.image_ref)?.image_ref || null;
  const coverImage = coverImageUrl ? await fetchImage(coverImageUrl) : null;

  const interiorImages = new Map<string, { buffer: Buffer; type: DocxImageType }>();
  for (const p of placements ?? []) {
    if (!p.chapter_id || !p.file_ref) continue;
    const image = await fetchImage(p.file_ref);
    if (image) interiorImages.set(p.chapter_id, image);
  }

  const { data: formattingJob, error: jobError } = await supabase
    .from("formatting_jobs")
    .insert({ project_id: project.id, output_formats: ["docx"], status: "processing" })
    .select()
    .single();
  if (jobError) throw new Error(jobError.message);

  try {
    const titleParagraphs = [
      ...(coverImage
        ? [
            new Paragraph({
              children: [new ImageRun({ type: coverImage.type, data: coverImage.buffer, transformation: { width: 400, height: 400 } })],
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            }),
          ]
        : []),
      new Paragraph({
        text: identity?.working_title || "Untitled Project",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: coverImage ? 0 : 2400 },
      }),
      ...(identity?.subtitle
        ? [new Paragraph({ text: identity.subtitle, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER })]
        : []),
      ...(identity?.author_name
        ? [new Paragraph({ text: identity.author_name, alignment: AlignmentType.CENTER, spacing: { before: 480 } })]
        : []),
      new Paragraph({ children: [new PageBreak()] }),
    ];

    const chapterCount = (chapters ?? []).length;
    const chapterParagraphs = (chapters ?? []).flatMap((chapter, chapterIndex) => {
      const image = interiorImages.get(chapter.id);
      const bodyParagraphs = chapter.content
        .split(/\n{2,}/)
        .filter((p: string) => p.trim().length > 0)
        .map(
          (p: string, i: number) =>
            new Paragraph({
              children: [new TextRun(p.trim())],
              alignment: AlignmentType.JUSTIFIED,
              indent: i === 0 ? undefined : { firstLine: FIRST_LINE_INDENT },
            })
        );

      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 1200, after: chapter.title ? 80 : 480 },
          children: [new TextRun({ text: `Chapter ${numberToWords(chapter.chapter_number)}`, bold: true, size: 28 })],
        }),
        ...(chapter.title
          ? [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 480 },
                children: [new TextRun({ text: chapter.title, italics: true, size: 24 })],
              }),
            ]
          : []),
        ...(image
          ? [
              new Paragraph({
                children: [new ImageRun({ type: image.type, data: image.buffer, transformation: { width: 300, height: 300 } })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
              }),
            ]
          : []),
        ...bodyParagraphs,
        ...(chapterIndex < chapterCount - 1 ? [new Paragraph({ children: [new PageBreak()] })] : []),
      ];
    });

    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: BODY_FONT, size: 24 } },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: convertInchesToTwip(6), height: convertInchesToTwip(9) },
              margin: {
                top: convertInchesToTwip(0.75),
                bottom: convertInchesToTwip(0.75),
                left: convertInchesToTwip(0.75),
                right: convertInchesToTwip(0.75),
              },
            },
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ children: [PageNumber.CURRENT] })],
                }),
              ],
            }),
          },
          children: [...titleParagraphs, ...chapterParagraphs],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const path = `${project.user_id}/${project.id}/manuscript.docx`;

    const { error: uploadError } = await supabase.storage.from("exports").upload(path, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    await supabase
      .from("formatting_jobs")
      .update({ status: "complete", output_files: [path] })
      .eq("id", formattingJob.id);

    await supabase.from("export_records").insert({
      project_id: project.id,
      export_type: "full_manuscript",
      file_ref: path,
    });

    // Final Quality Gate (Step 10) — a deterministic summary of everything
    // Steps 5-9 already produced, computed now that every input exists.
    const gate = await computeQualityGate(supabase, project.id);

    await supabase.from("projects").update({ status: "READY_FOR_REVIEW" }).eq("id", project.id);

    const embeddedImages = (coverImage ? 1 : 0) + interiorImages.size;
    return {
      processed: true,
      detail: `Project ${project.id}: manuscript.docx generated (${embeddedImages} image(s) embedded), quality gate scored ${gate.overall_readiness_score}/100, moved to READY_FOR_REVIEW.`,
    };
  } catch (e) {
    await supabase.from("formatting_jobs").update({ status: "failed" }).eq("id", formattingJob.id);
    throw e;
  }
}

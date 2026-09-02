import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  PageBreak,
  ImageRun,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  convertInchesToTwip,
  Table,
  TableRow,
  TableCell,
  TableOfContents,
  WidthType,
  BorderStyle,
  ShadingType,
  NumberFormat,
  SectionType,
} from "docx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeQualityGate } from "@/lib/quality-gate";
import { getPausedProjectIds } from "@/lib/production-paused";
import {
  getDesignFamily,
  getDesignProfile,
  trimSizeInches,
  contentWidthTwips,
  PAGE_MARGIN_IN,
  type BookDesignProfile,
} from "@/lib/book-format";
import { fitToWidth } from "@/lib/image-dimensions";

type DocxImageType = "jpg" | "png" | "gif" | "bmp";
type DocElement = Paragraph | Table;
type LoadedImage = { buffer: Buffer; type: DocxImageType };

/**
 * Real cover/interior artwork lives in public storage buckets as plain
 * URLs (cover_department.concepts[].image_ref, image_placements.file_ref)
 * — docx's ImageRun needs actual bytes, not a URL, so this fetches them at
 * export time. Best-effort: a fetch failure just means that one image is
 * skipped, never a reason to fail the whole manuscript export.
 */
async function fetchImage(url: string): Promise<LoadedImage | null> {
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

const FIRST_LINE_INDENT = convertInchesToTwip(0.5);
const LIST_INDENT = convertInchesToTwip(0.25);
const HAIRLINE = { style: BorderStyle.SINGLE, size: 4, color: "999999" };

// ---------------------------------------------------------------------------
// Callouts (spec: NOTE/TIP/WARNING/IMPORTANT/KEY TAKEAWAY/ACTION STEP/
// DEFINITION/EXAMPLE) and plain block quotations — both opt-in per Book
// Design Profile (lib/book-format.ts) and only ever rendered when the
// Writing Agent's own '> LABEL: text' markup is present in the source, so
// nothing here invents content that isn't in the manuscript.
// ---------------------------------------------------------------------------

const CALLOUT_LABELS = [
  "NOTE", "TIP", "WARNING", "IMPORTANT", "KEY TAKEAWAY", "ACTION STEP", "DEFINITION", "EXAMPLE",
] as const;
type CalloutLabel = (typeof CALLOUT_LABELS)[number];
const CALLOUT_FILL: Record<CalloutLabel, string> = {
  NOTE: "EAF2FB",
  TIP: "EAF7EF",
  WARNING: "FCEAEA",
  IMPORTANT: "FCEAEA",
  "KEY TAKEAWAY": "FFF6E0",
  "ACTION STEP": "F0EAFB",
  DEFINITION: "F2F2F2",
  EXAMPLE: "EAF7EF",
};
const CALLOUT_PATTERN = new RegExp(`^>\\s*(${CALLOUT_LABELS.join("|")}):\\s*(.*)`);

// docx always serializes a paragraph's w:pBdr children as top/bottom/left/
// right regardless of the order given here, which violates OOXML's actual
// required sequence (top, left, bottom, right, ...) the moment more than
// one side is set — Word tolerates it, but strict validators (and some
// other readers) reject it. A left-accent bar — one border side plus a
// tinted background, the same convention many published technical books
// and docs sites use for callouts — sidesteps the bug entirely and reads
// as more contemporary than a full box anyway.
const CALLOUT_ACCENT = { style: BorderStyle.SINGLE, size: 18, color: "8899AA" };

function calloutBoxParagraph(children: TextRun[], fill: string, isFirst: boolean, isLast: boolean): Paragraph {
  return new Paragraph({
    shading: { fill, type: ShadingType.CLEAR },
    border: { left: CALLOUT_ACCENT },
    indent: { left: 180, right: 180 },
    spacing: { before: isFirst ? 160 : 0, after: isLast ? 200 : 0 },
    children,
  });
}

function quoteParagraph(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    indent: { left: LIST_INDENT },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: "999999", space: 8 } },
    spacing: { before: 160, after: 200 },
    children: [new TextRun({ text, italics: true })],
  });
}

// ---------------------------------------------------------------------------
// Tables — parsed from GitHub-flavored Markdown pipe tables. Header row is
// shaded and repeats on every page the table spans (tableHeader: true).
// ---------------------------------------------------------------------------

function isTableSeparatorRow(line: string): boolean {
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(line.trim());
}
function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}
function buildTable(rows: string[][], widthTwips: number): Table {
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidth = Math.floor(widthTwips / colCount);
  return new Table({
    width: { size: widthTwips, type: WidthType.DXA },
    columnWidths: new Array(colCount).fill(colWidth),
    borders: { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE, insideHorizontal: HAIRLINE, insideVertical: HAIRLINE },
    rows: rows.map(
      (cells, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: Array.from({ length: colCount }, (_, i) => cells[i] ?? "").map(
            (cellText) =>
              new TableCell({
                width: { size: colWidth, type: WidthType.DXA },
                shading: rowIndex === 0 ? { fill: "E8E8E8", type: ShadingType.CLEAR } : undefined,
                margins: { top: 80, bottom: 80, left: 100, right: 100 },
                children: [new Paragraph({ children: [new TextRun({ text: cellText, bold: rowIndex === 0, size: 20 })] })],
              })
          ),
        })
    ),
  });
}

/**
 * Renders the Writing Agent's lightweight-Markdown output (structured
 * families only — see lib/book-format.ts) into real docx elements: '## '/
 * '### ' headings, '- '/numbered lists with a hanging indent, fenced ```
 * code blocks in a monospace font with light shading, '> LABEL: text'
 * callout boxes, plain '> text' block quotations, and pipe-table syntax
 * rendered as a real docx Table. Plain text is left-aligned, block-style
 * (no first-line indent, spacing between paragraphs) — the standard
 * non-fiction/guide convention, as opposed to fiction's justified+indented
 * prose (renderProseContent below). Unrecognized syntax is just treated as
 * plain text, never dropped.
 */
function renderStructuredContent(content: string, contentWidth: number): DocElement[] {
  const elements: DocElement[] = [];
  let textBuffer: string[] = [];
  let codeBuffer: string[] | null = null;
  let calloutLines: { label: CalloutLabel; text: string }[] | null = null;
  let tableRows: string[][] | null = null;

  const flushText = () => {
    const text = textBuffer.join(" ").trim();
    if (text) elements.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 200 }, children: [new TextRun(text)] }));
    textBuffer = [];
  };
  const flushCallout = () => {
    if (calloutLines && calloutLines.length > 0) {
      const fill = CALLOUT_FILL[calloutLines[0].label];
      calloutLines.forEach((line, i) => {
        const isFirst = i === 0;
        const isLast = i === calloutLines!.length - 1;
        const children = isFirst
          ? [new TextRun({ text: `${line.label}: `, bold: true }), new TextRun(line.text)]
          : [new TextRun(line.text)];
        elements.push(calloutBoxParagraph(children, fill, isFirst, isLast));
      });
    }
    calloutLines = null;
  };
  const flushTable = () => {
    if (tableRows && tableRows.length >= 2) {
      elements.push(buildTable(tableRows, contentWidth));
      elements.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
    }
    tableRows = null;
  };

  const lines = content.split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trimEnd();

    if (line.trim().startsWith("```")) {
      if (codeBuffer === null) {
        flushText();
        flushCallout();
        flushTable();
        codeBuffer = [];
      } else {
        codeBuffer.forEach((codeLine, i) => {
          elements.push(
            new Paragraph({
              shading: { fill: "F2F2F2", type: ShadingType.CLEAR },
              spacing: { after: i === codeBuffer!.length - 1 ? 200 : 0 },
              children: [new TextRun({ text: codeLine || " ", font: "Courier New", size: 20 })],
            })
          );
        });
        codeBuffer = null;
      }
      continue;
    }
    if (codeBuffer !== null) {
      codeBuffer.push(line);
      continue;
    }

    const nextLine = lines[idx + 1]?.trim() ?? "";
    if (tableRows === null && /^\|.*\|\s*$/.test(line.trim()) && isTableSeparatorRow(nextLine)) {
      flushText();
      flushCallout();
      tableRows = [parseTableRow(line)];
      idx++; // consume the '|---|---|' separator row
      continue;
    }
    if (tableRows !== null) {
      if (/^\|.*\|\s*$/.test(line.trim())) {
        tableRows.push(parseTableRow(line));
        continue;
      }
      flushTable();
    }

    const calloutMatch = line.match(CALLOUT_PATTERN);
    if (calloutMatch) {
      flushText();
      const [, label, text] = calloutMatch;
      if (calloutLines === null) calloutLines = [];
      calloutLines.push({ label: label as CalloutLabel, text });
      continue;
    }
    if (calloutLines !== null) {
      const continuation = line.match(/^>\s*(.*)/);
      if (continuation) {
        calloutLines.push({ label: calloutLines[0].label, text: continuation[1] });
        continue;
      }
      flushCallout();
    }

    const quoteMatch = line.match(/^>\s+(.*)/);
    if (quoteMatch) {
      flushText();
      elements.push(quoteParagraph(quoteMatch[1]));
      continue;
    }

    const heading3 = line.match(/^###\s+(.*)/);
    const heading2 = !heading3 && line.match(/^##\s+(.*)/);
    const bullet = line.match(/^[-*]\s+(.*)/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)/);

    if (heading2 || heading3) {
      flushText();
      const [, text] = (heading2 || heading3) as RegExpMatchArray;
      elements.push(
        new Paragraph({
          heading: heading2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          keepNext: true,
          alignment: AlignmentType.LEFT,
          spacing: { before: 320, after: 160 },
          children: [new TextRun({ text, bold: true, size: heading2 ? 26 : 24 })],
        })
      );
    } else if (bullet) {
      flushText();
      elements.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { left: LIST_INDENT, hanging: LIST_INDENT },
          spacing: { after: 120 },
          children: [new TextRun(`•  ${bullet[1]}`)],
        })
      );
    } else if (numbered) {
      flushText();
      elements.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { left: LIST_INDENT, hanging: LIST_INDENT },
          spacing: { after: 120 },
          children: [new TextRun(`${numbered[1]}.  ${numbered[2]}`)],
        })
      );
    } else if (line.trim().length === 0) {
      flushText();
    } else {
      textBuffer.push(line.trim());
    }
  }
  flushText();
  flushCallout();
  flushTable();
  return elements;
}

function renderProseContent(content: string, profile: BookDesignProfile): Paragraph[] {
  return content
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0)
    .map(
      (p, i) =>
        new Paragraph({
          children: [new TextRun(p.trim())],
          alignment: profile.bodyAlignment,
          indent: profile.firstLineIndent && i > 0 ? { firstLine: FIRST_LINE_INDENT } : undefined,
          spacing: profile.paragraphSpacingAfter ? { after: profile.paragraphSpacingAfter } : undefined,
        })
    );
}

function emptyHeader(): Header {
  return new Header({ children: [new Paragraph({})] });
}
function emptyFooter(): Footer {
  return new Footer({ children: [new Paragraph({})] });
}
function pageNumberFooter(): Footer {
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] });
}
function runningHeader(text: string): Header {
  return new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: text.toUpperCase(), size: 18 })] })] });
}

/**
 * Assembles the approved manuscript into a real, professionally formatted
 * DOCX and stores it in the private `exports` bucket. Trim size comes from
 * the wizard's own choice (project_scope.trim_size, defaulting to 6x9in —
 * a standard KDP paperback size).
 *
 * Body formatting follows the project's Book Design Profile
 * (lib/book-format.ts), decided once from its book_type and applied
 * identically to every chapter from first page to last: fiction gets
 * justified prose with first-line indents; children's gets large,
 * left-aligned, generously spaced type; self-help and technical/
 * educational get real structure — headings, bullet/numbered lists, code
 * blocks, callout boxes, and tables, all parsed from the Writing Agent's
 * lightweight Markdown.
 *
 * The document is built as one section per chapter (plus a front-matter
 * and, when there's real data for it, a back-matter section) so page
 * numbering and running headers can be genuinely context-aware: front
 * matter uses lowercase Roman numerals with the number suppressed on the
 * title page itself; the body restarts at Arabic 1 and runs a chapter
 * title on odd pages / the book title on even pages, both suppressed on
 * each chapter's own opening page. A real, auto-updating Table of Contents
 * field is generated from the actual chapter headings — never a
 * hand-typed fake one. EPUB/PDF aren't implemented yet — output_formats
 * only ever lists what was actually produced, never a format that doesn't
 * exist as a real file.
 */
export async function runFormattingDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const pausedProjectIds = await getPausedProjectIds(supabase);

  let projectQuery = supabase.from("projects").select("id, user_id, book_type").eq("status", "FORMATTING");
  if (pausedProjectIds.length > 0) {
    projectQuery = projectQuery.not("id", "in", `(${pausedProjectIds.join(",")})`);
  }
  const { data: project, error: projectQueryError } = await projectQuery
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);
  if (!project) return { processed: false, detail: "No projects awaiting formatting." };

  const [{ data: identity }, { data: scope }, { data: chapters }, { data: cover }, { data: placements }] = await Promise.all([
    supabase.from("project_identity").select("*").eq("project_id", project.id).single(),
    supabase.from("project_scope").select("trim_size").eq("project_id", project.id).maybeSingle(),
    supabase
      .from("chapters")
      .select("id, chapter_number, title, content")
      .eq("project_id", project.id)
      .order("chapter_number", { ascending: true }),
    supabase.from("cover_department").select("concepts, final_cover_ref").eq("project_id", project.id).maybeSingle(),
    supabase.from("image_placements").select("chapter_id, placement_location, file_ref").eq("project_id", project.id).eq("status", "generated"),
  ]);

  const family = getDesignFamily(project.book_type);
  const profile = getDesignProfile(project.book_type);
  const { widthIn, heightIn } = trimSizeInches(scope?.trim_size);
  const contentWidth = contentWidthTwips(scope?.trim_size);
  const pageSize = { width: convertInchesToTwip(widthIn), height: convertInchesToTwip(heightIn) };
  const pageMargin = {
    top: convertInchesToTwip(PAGE_MARGIN_IN),
    bottom: convertInchesToTwip(PAGE_MARGIN_IN),
    left: convertInchesToTwip(PAGE_MARGIN_IN),
    right: convertInchesToTwip(PAGE_MARGIN_IN),
  };

  const coverConcepts = (cover?.concepts as { image_ref: string | null; status: string }[] | undefined) ?? [];
  const coverImageUrl = cover?.final_cover_ref || coverConcepts.find((c) => c.status === "generated" && c.image_ref)?.image_ref || null;
  const coverImage = coverImageUrl ? await fetchImage(coverImageUrl) : null;

  const interiorImagesByChapter = new Map<string, { file_ref: string; placement_location: string | null }[]>();
  for (const p of placements ?? []) {
    if (!p.chapter_id || !p.file_ref) continue;
    const list = interiorImagesByChapter.get(p.chapter_id) ?? [];
    list.push({ file_ref: p.file_ref, placement_location: p.placement_location });
    interiorImagesByChapter.set(p.chapter_id, list);
  }

  const { data: formattingJob, error: jobError } = await supabase
    .from("formatting_jobs")
    .insert({ project_id: project.id, output_formats: ["docx"], status: "processing" })
    .select()
    .single();
  if (jobError) throw new Error(jobError.message);

  try {
    const title = identity?.working_title || "Untitled Project";
    const year = new Date().getFullYear();

    // ---- Front matter: title page, copyright page, real TOC field ----
    const titlePageParagraphs = [
      ...(coverImage
        ? [
            new Paragraph({
              children: [new ImageRun({ type: coverImage.type, data: coverImage.buffer, transformation: fitToWidth(coverImage.buffer, 400) })],
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            }),
          ]
        : []),
      new Paragraph({
        text: title,
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

    const copyrightParagraphs = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 3600, after: 160 },
        children: [new TextRun(`Copyright © ${year} ${identity?.author_name || "[AUTHOR NAME]"}`)],
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun("All rights reserved.")] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new TextRun({
            size: 18,
            text:
              "No part of this publication may be reproduced, distributed, or transmitted in any form or by any means, " +
              "including photocopying, recording, or other electronic or mechanical methods, without the prior written " +
              "permission of the publisher, except in the case of brief quotations embodied in critical reviews and " +
              "certain other noncommercial uses permitted by copyright law.",
          }),
        ],
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Publisher: [PUBLISHER / IMPRINT]", size: 18 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "ISBN: [ISBN]", size: 18 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "First Edition", size: 18 })] }),
      new Paragraph({ children: [new PageBreak()] }),
    ];

    const tocParagraphs = [
      new Paragraph({ text: "Table of Contents", heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 320 } }),
      new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-1" }),
    ];

    const frontMatterSection = {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pageSize, margin: pageMargin, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } },
        titlePage: true,
      },
      headers: { default: emptyHeader(), first: emptyHeader() },
      footers: { default: pageNumberFooter(), first: emptyFooter() },
      children: [...titlePageParagraphs, ...copyrightParagraphs, ...tocParagraphs],
    };

    // ---- Body: one docx section per chapter, so running headers/page
    // numbering can genuinely change per chapter and reset at the body. ----
    let figureNumber = 0;
    const chapterList = chapters ?? [];
    const chapterSections = await Promise.all(
      chapterList.map(async (chapter, chapterIndex) => {
        const images = interiorImagesByChapter.get(chapter.id) ?? [];
        const loadedImages: { image: LoadedImage; caption: string | null }[] = [];
        for (const p of images) {
          const image = await fetchImage(p.file_ref);
          if (image) {
            figureNumber++;
            loadedImages.push({ image, caption: `Figure ${figureNumber}${p.placement_location ? `. ${p.placement_location}` : ""}` });
          }
        }

        const bodyElements: DocElement[] = family === "fiction" ? renderProseContent(chapter.content, profile) : renderStructuredContent(chapter.content, contentWidth);

        const imageElements: Paragraph[] = loadedImages.flatMap(({ image, caption }) => [
          new Paragraph({
            children: [new ImageRun({ type: image.type, data: image.buffer, transformation: fitToWidth(image.buffer, 300) })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [new TextRun({ text: caption ?? "", italics: true, size: 18 })],
          }),
        ]);

        const chapterHeadingText = `Chapter ${numberToWords(chapter.chapter_number)}`;
        const children: DocElement[] = [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            keepNext: true,
            alignment: AlignmentType.CENTER,
            spacing: { before: 1200, after: chapter.title ? 80 : 480 },
            children: [new TextRun({ text: chapterHeadingText, bold: true, size: profile.chapterHeadingSize })],
          }),
          ...(chapter.title
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 480 },
                  children: [new TextRun({ text: chapter.title, italics: profile.chapterTitleItalic, bold: !profile.chapterTitleItalic, size: 24 })],
                }),
              ]
            : []),
          ...imageElements,
          ...bodyElements,
        ];

        return {
          properties: {
            type: SectionType.NEXT_PAGE,
            page: {
              size: pageSize,
              margin: pageMargin,
              ...(chapterIndex === 0 ? { pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } : {}),
            },
            titlePage: true,
          },
          headers: { default: runningHeader(chapter.title || chapterHeadingText), even: runningHeader(title), first: emptyHeader() },
          footers: { default: pageNumberFooter(), first: pageNumberFooter() },
          children,
        };
      })
    );

    // ---- Back matter: only what's actually backed by real data. ----
    const backMatterSections = identity?.author_name
      ? [
          {
            properties: { type: SectionType.NEXT_PAGE, page: { size: pageSize, margin: pageMargin } },
            headers: { default: emptyHeader() },
            footers: { default: pageNumberFooter() },
            children: [
              new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 320 }, text: "About the Author" }),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: identity.author_name, bold: true })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "[Add a short author bio here.]", italics: true })] }),
            ],
          },
        ]
      : [];

    const doc = new Document({
      evenAndOddHeaderAndFooters: true,
      features: { updateFields: true },
      styles: {
        default: {
          document: {
            run: { font: profile.bodyFont, size: profile.bodySize },
          },
        },
      },
      sections: [frontMatterSection, ...chapterSections, ...backMatterSections],
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

    const embeddedImages = (coverImage ? 1 : 0) + figureNumber;
    return {
      processed: true,
      detail: `Project ${project.id}: manuscript.docx generated (${family} design profile, ${embeddedImages} image(s) embedded), quality gate scored ${gate.overall_readiness_score}/100, moved to READY_FOR_REVIEW.`,
    };
  } catch (e) {
    await supabase.from("formatting_jobs").update({ status: "failed" }).eq("id", formattingJob.id);
    throw e;
  }
}

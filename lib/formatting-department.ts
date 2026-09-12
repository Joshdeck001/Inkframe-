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
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeQualityGate } from "@/lib/quality-gate";
import { getPausedProjectIds } from "@/lib/production-paused";
import {
  getDesignFamily,
  getDesignProfile,
  trimSizeInches,
  contentWidthTwips,
  PAGE_MARGIN_IN,
  numberToWords,
  type BookDesignProfile,
} from "@/lib/book-format";
import { fitToWidth } from "@/lib/image-dimensions";
import { parseManuscriptBlocks, parseInlineEmphasis, type CalloutLabel } from "@/lib/manuscript-blocks";
import { fetchImage, type LoadedImage } from "@/lib/fetch-image";
import { buildEpubBuffer, type EpubSectionInput } from "@/lib/epub-builder";
import { sanitizeManuscriptText } from "@/lib/text-sanitize";
import {
  buildNormalizedDocumentModel,
  validateDocumentStructure,
  CURRENT_DOCUMENT_MODEL_VERSION,
  CURRENT_FORMATTER_VERSION,
  type RawSection,
  type NormalizedSection,
} from "@/lib/document-model";

type DocElement = Paragraph | Table;

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

// docx always serializes a paragraph's w:pBdr children as top/bottom/left/
// right regardless of the order given here, which violates OOXML's actual
// required sequence (top, left, bottom, right, ...) the moment more than
// one side is set — Word tolerates it, but strict validators (and some
// other readers) reject it. A left-accent bar — one border side plus a
// tinted background, the same convention many published technical books
// and docs sites use for callouts — sidesteps the bug entirely and reads
// as more contemporary than a full box anyway.
const CALLOUT_ACCENT = { style: BorderStyle.SINGLE, size: 18, color: "8899AA" };

/**
 * Splits text on inline Markdown emphasis markers (parseInlineEmphasis,
 * lib/manuscript-blocks.ts) into real docx TextRuns instead of leaving the
 * literal marker characters in the output — every base style (a heading's
 * size, a quote's italics, a callout's default weight) still applies to
 * every resulting run, on top of whatever that specific span adds.
 */
function inlineRuns(text: string, base: { bold?: boolean; italics?: boolean; size?: number; font?: string } = {}) {
  return parseInlineEmphasis(text).map(
    (span) =>
      new TextRun({
        text: span.text,
        bold: base.bold || span.bold || undefined,
        italics: base.italics || span.italic || undefined,
        size: base.size,
        font: base.font,
      })
  );
}

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
    children: inlineRuns(text, { italics: true }),
  });
}

// ---------------------------------------------------------------------------
// Tables — parsed from GitHub-flavored Markdown pipe tables (see
// lib/manuscript-blocks.ts). Header row is shaded and repeats on every page
// the table spans (tableHeader: true).
// ---------------------------------------------------------------------------

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
                children: [new Paragraph({ children: inlineRuns(cellText, { bold: rowIndex === 0, size: 20 }) })],
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
  for (const block of parseManuscriptBlocks(content)) {
    switch (block.type) {
      case "paragraph":
        elements.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 200 }, children: inlineRuns(block.text) }));
        break;
      case "heading":
        elements.push(
          new Paragraph({
            heading: block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            keepNext: true,
            alignment: AlignmentType.LEFT,
            spacing: { before: 320, after: 160 },
            children: inlineRuns(block.text, { bold: true, size: block.level === 2 ? 26 : 24 }),
          })
        );
        break;
      case "bullet":
        elements.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            indent: { left: LIST_INDENT, hanging: LIST_INDENT },
            spacing: { after: 120 },
            children: [new TextRun("•  "), ...inlineRuns(block.text)],
          })
        );
        break;
      case "numbered":
        elements.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            indent: { left: LIST_INDENT, hanging: LIST_INDENT },
            spacing: { after: 120 },
            children: [new TextRun(`${block.marker}.  `), ...inlineRuns(block.text)],
          })
        );
        break;
      case "code":
        block.lines.forEach((codeLine, i) => {
          elements.push(
            new Paragraph({
              shading: { fill: "F2F2F2", type: ShadingType.CLEAR },
              spacing: { after: i === block.lines.length - 1 ? 200 : 0 },
              children: [new TextRun({ text: codeLine || " ", font: "Courier New", size: 20 })],
            })
          );
        });
        break;
      case "callout": {
        const fill = CALLOUT_FILL[block.label];
        block.lines.forEach((lineText, i) => {
          const isFirst = i === 0;
          const isLast = i === block.lines.length - 1;
          const children = isFirst
            ? [new TextRun({ text: `${block.label}: `, bold: true }), ...inlineRuns(lineText)]
            : inlineRuns(lineText);
          elements.push(calloutBoxParagraph(children, fill, isFirst, isLast));
        });
        break;
      }
      case "quote":
        elements.push(quoteParagraph(block.text));
        break;
      case "table":
        elements.push(buildTable(block.rows, contentWidth));
        elements.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
        break;
    }
  }
  return elements;
}

function renderProseContent(content: string, profile: BookDesignProfile): Paragraph[] {
  return content
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0)
    .map(
      (p, i) =>
        new Paragraph({
          children: inlineRuns(p.trim()),
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
 * hand-typed fake one.
 *
 * A real EPUB 3 (lib/epub-builder.ts) is generated alongside it from the
 * same content — same Book Design Profile, same chapters/images, same
 * manuscript-block parsing (lib/manuscript-blocks.ts) — so a Markdown
 * syntax fix or a new callout type only ever needs to happen once and
 * both formats stay in sync. PDF isn't implemented; output_formats only
 * ever lists what was actually produced, never a format that doesn't
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
      .select("id, chapter_number, title, content, section_type, section_type_confidence")
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

  const rawChapters: RawSection[] = (chapters ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    content: c.content,
    chapter_number: c.chapter_number,
    section_type: c.section_type,
    section_type_confidence: c.section_type_confidence,
  }));
  const sourceContentHash = createHash("sha256").update(rawChapters.map((c) => `${c.id}:${c.content}`).join("|")).digest("hex");

  const { data: formattingJob, error: jobError } = await supabase
    .from("formatting_jobs")
    .insert({
      project_id: project.id,
      output_formats: ["docx", "epub"],
      status: "processing",
      formatter_version: CURRENT_FORMATTER_VERSION,
      document_model_version: CURRENT_DOCUMENT_MODEL_VERSION,
      source_content_hash: sourceContentHash,
    })
    .select()
    .single();
  if (jobError) throw new Error(jobError.message);

  try {
    const title = identity?.working_title || "Untitled Project";
    const year = new Date().getFullYear();

    // ---- The normalized document model (lib/document-model.ts) — the ONE
    // structure DOCX, EPUB, and the TOC/running-header logic below all
    // derive from, replacing the old assumption that every chapters row is
    // a numbered chapter. Any row still unclassified (section_type NULL —
    // a project created before this architecture existed) gets classified
    // now via the same shared classifier every other write path uses, and
    // that classification is persisted back so it doesn't need re-guessing
    // on the next run. ----
    const model = buildNormalizedDocumentModel(rawChapters);
    const toBackfill = model.sections.filter((s, i) => !rawChapters[i]?.section_type);
    if (toBackfill.length > 0) {
      await Promise.all(
        toBackfill.map((s) =>
          supabase
            .from("chapters")
            .update({ section_type: s.sectionType, section_type_confidence: s.confidence, needs_classification_review: s.needsReview })
            .eq("id", s.id)
        )
      );
    }
    // Defensive sanitization pass — the primary pass runs at import
    // ingestion (lib/manuscript-import.ts), but this catches anything
    // written directly by the AI writer, or content saved before the
    // ingestion-time pass existed.
    for (const section of model.sections) {
      section.title = section.title ? sanitizeManuscriptText(section.title) : section.title;
      section.content = sanitizeManuscriptText(section.content);
    }
    const structureValidation = validateDocumentStructure(model);

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

    // Publisher/ISBN are real, optional fields (project_identity.publisher_name/
    // isbn) — never a bracketed placeholder in the shipped file. When the
    // author hasn't provided one, the line is omitted entirely rather than
    // printing "[PUBLISHER / IMPRINT]"/"[ISBN]" — Book Health (lib/book-
    // passport.ts) is where "not provided" gets surfaced to the author, not
    // the exported book itself. Same for author name: a missing one omits
    // the name from the copyright line rather than printing "[AUTHOR NAME]"
    // in a file that might actually get published.
    const copyrightParagraphs = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 3600, after: 160 },
        children: [new TextRun(identity?.author_name ? `Copyright © ${year} ${identity.author_name}` : `Copyright © ${year}`)],
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
      ...(identity?.publisher_name
        ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: `Publisher: ${identity.publisher_name}`, size: 18 })] })]
        : []),
      ...(identity?.isbn
        ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: `ISBN: ${identity.isbn}`, size: 18 })] })]
        : []),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "First Edition", size: 18 })] }),
      new Paragraph({ children: [new PageBreak()] }),
    ];

    const tocParagraphs = [
      new Paragraph({ text: "Table of Contents", heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 320 } }),
      new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-1" }),
    ];

    // Any chapters row classified as real front matter (e.g. a Dedication) —
    // rendered as its own centered page, using its own title/content, never
    // treated as a numbered chapter. Comes from the normalized model, not a
    // separate hand-maintained list, per the "one document model" requirement.
    const frontMatterDbParagraphs = model.sections
      .filter((s) => s.sectionType === "front_matter")
      .flatMap((s) => [
        new Paragraph({ text: s.title || "", heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 320 } }),
        ...renderProseContent(s.content, { ...profile, bodyAlignment: AlignmentType.CENTER, firstLineIndent: false }),
        new Paragraph({ children: [new PageBreak()] }),
      ]);

    const frontMatterSection = {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pageSize, margin: pageMargin, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } },
        titlePage: true,
      },
      headers: { default: emptyHeader(), first: emptyHeader() },
      footers: { default: pageNumberFooter(), first: emptyFooter() },
      children: [...titlePageParagraphs, ...copyrightParagraphs, ...frontMatterDbParagraphs, ...tocParagraphs],
    };

    // ---- Load every section's interior images once, sequentially (not
    // Promise.all — figure numbers must increment in real reading order,
    // which parallel fetches racing each other can't guarantee), keyed by
    // section id (stable across front matter/introduction/chapter/
    // conclusion/back matter alike) and reused for both DOCX and EPUB. ----
    let figureNumber = 0;
    const imagesBySection = new Map<string, { image: LoadedImage; caption: string | null }[]>();
    for (const section of model.sections) {
      const images = interiorImagesByChapter.get(section.id) ?? [];
      const loaded: { image: LoadedImage; caption: string | null }[] = [];
      for (const p of images) {
        const image = await fetchImage(p.file_ref);
        if (image) {
          figureNumber++;
          loaded.push({ image, caption: `Figure ${figureNumber}${p.placement_location ? `. ${p.placement_location}` : ""}` });
        }
      }
      imagesBySection.set(section.id, loaded);
    }

    function imageElementsFor(section: NormalizedSection): Paragraph[] {
      return (imagesBySection.get(section.id) ?? []).flatMap(({ image, caption }) => [
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
    }

    // ---- Body: introduction (if present) + numbered chapters + conclusion
    // (if present), one docx section each, in normalized reading order —
    // replacing the old assumption that every chapters row was a numbered
    // chapter. Only sectionType === "chapter" ever gets a "Chapter N"
    // heading; introduction/conclusion use their own real title text
    // instead, and neither counts toward chapter numbering. Page numbering
    // restarts at 1 on whichever of these is genuinely first (the
    // Introduction when there is one, otherwise Chapter 1), not
    // hard-coded to "the first chapters row". ----
    const bodySectionModels = model.sections.filter((s) => s.sectionType === "introduction" || s.sectionType === "chapter" || s.sectionType === "conclusion");
    const chapterSections = bodySectionModels.map((section, bodyIndex) => {
      const bodyElements: DocElement[] = family === "fiction" ? renderProseContent(section.content, profile) : renderStructuredContent(section.content, contentWidth);
      const imageElements = imageElementsFor(section);

      const headingText =
        section.sectionType === "chapter"
          ? `Chapter ${numberToWords(section.displayNumber!)}`
          : section.title || (section.sectionType === "introduction" ? "Introduction" : "Conclusion");
      // A chapter shows its own title as a subtitle line under "Chapter N";
      // an introduction/conclusion's title IS the heading already, so there's
      // no separate subtitle line for those.
      const subtitleText = section.sectionType === "chapter" ? section.title : null;

      const children: DocElement[] = [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          keepNext: true,
          alignment: AlignmentType.CENTER,
          spacing: { before: 1200, after: subtitleText ? 80 : 480 },
          children: [new TextRun({ text: headingText, bold: true, size: profile.chapterHeadingSize })],
        }),
        ...(subtitleText
          ? [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 480 },
                children: inlineRuns(subtitleText, { italics: profile.chapterTitleItalic, bold: !profile.chapterTitleItalic, size: 24 }),
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
            ...(bodyIndex === 0 ? { pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } : {}),
          },
          titlePage: true,
        },
        headers: { default: runningHeader(section.title || headingText), even: runningHeader(title), first: emptyHeader() },
        footers: { default: pageNumberFooter(), first: pageNumberFooter() },
        children,
      };
    });

    // ---- Back matter: real chapters-row back matter (e.g. a Glossary),
    // then the existing "About the Author" page, only when there's real
    // data for it. ----
    const backMatterDbSections = model.sections
      .filter((s) => s.sectionType === "back_matter")
      .map((section) => {
        const bodyElements: DocElement[] = family === "fiction" ? renderProseContent(section.content, profile) : renderStructuredContent(section.content, contentWidth);
        const headingText = section.title || "Appendix";
        return {
          properties: { type: SectionType.NEXT_PAGE, page: { size: pageSize, margin: pageMargin }, titlePage: true },
          headers: { default: runningHeader(headingText), even: runningHeader(title), first: emptyHeader() },
          footers: { default: pageNumberFooter(), first: pageNumberFooter() },
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 320 }, text: headingText }),
            ...imageElementsFor(section),
            ...bodyElements,
          ],
        };
      });

    const aboutAuthorSections = identity?.author_name
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
      sections: [frontMatterSection, ...chapterSections, ...backMatterDbSections, ...aboutAuthorSections],
    });

    const docxBuffer = await Packer.toBuffer(doc);
    const epubSections: EpubSectionInput[] = model.sections.map((section) => ({
      sectionType: section.sectionType,
      displayNumber: section.displayNumber,
      title: section.title,
      content: section.content,
      images: imagesBySection.get(section.id) ?? [],
    }));
    const epubBuffer = await buildEpubBuffer({
      title,
      subtitle: identity?.subtitle ?? null,
      authorName: identity?.author_name ?? null,
      publisherName: identity?.publisher_name ?? null,
      isbn: identity?.isbn ?? null,
      family,
      coverImage,
      sections: epubSections,
    });

    const docxPath = `${project.user_id}/${project.id}/manuscript.docx`;
    const epubPath = `${project.user_id}/${project.id}/manuscript.epub`;

    const [{ error: docxUploadError }, { error: epubUploadError }] = await Promise.all([
      supabase.storage.from("exports").upload(docxPath, docxBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      }),
      supabase.storage.from("exports").upload(epubPath, epubBuffer, {
        contentType: "application/epub+zip",
        upsert: true,
      }),
    ]);
    if (docxUploadError) throw new Error(docxUploadError.message);
    if (epubUploadError) throw new Error(epubUploadError.message);

    // A real structural problem (duplicate conclusion, an unresolved
    // placeholder, leftover broken Unicode) marks this build
    // "needs_attention" rather than "complete" — the files still exist and
    // upload (so the author/support can see exactly what's wrong), but this
    // build's own record is honest that it isn't a clean pass. Book Health
    // (lib/book-passport.ts) is the actual publication-readiness gate and
    // re-validates independently, so this never silently blocks the
    // pipeline — the project still moves forward to review.
    await supabase
      .from("formatting_jobs")
      .update({
        status: structureValidation.errors.length > 0 ? "needs_attention" : "complete",
        output_files: [docxPath, epubPath],
      })
      .eq("id", formattingJob.id);

    await supabase.from("export_records").insert([
      { project_id: project.id, export_type: "full_manuscript", file_ref: docxPath },
      { project_id: project.id, export_type: "full_manuscript", file_ref: epubPath },
    ]);

    // Final Quality Gate (Step 10) — a deterministic summary of everything
    // Steps 5-9 already produced, computed now that every input exists.
    const gate = await computeQualityGate(supabase, project.id);

    await supabase.from("projects").update({ status: "READY_FOR_REVIEW" }).eq("id", project.id);

    const embeddedImages = (coverImage ? 1 : 0) + figureNumber;
    const structureNote =
      structureValidation.errors.length > 0
        ? ` STRUCTURE ISSUES FOUND (${structureValidation.errors.length}): ${structureValidation.errors.join(" | ")}`
        : structureValidation.warnings.length > 0
          ? ` (${structureValidation.warnings.length} classification warning(s) — see Book Health)`
          : "";
    return {
      processed: true,
      detail: `Project ${project.id}: manuscript.docx and manuscript.epub generated (${family} design profile, ${embeddedImages} image(s) embedded), quality gate scored ${gate.overall_readiness_score}/100, moved to READY_FOR_REVIEW.${structureNote}`,
    };
  } catch (e) {
    await supabase.from("formatting_jobs").update({ status: "failed" }).eq("id", formattingJob.id);
    throw e;
  }
}

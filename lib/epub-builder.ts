import JSZip from "jszip";
import { randomUUID } from "crypto";
import { parseManuscriptBlocks, type ManuscriptBlock } from "@/lib/manuscript-blocks";
import { numberToWords, type BookDesignFamily } from "@/lib/book-format";
import type { LoadedImage } from "@/lib/fetch-image";

/**
 * A real EPUB 3 book — same content model as the DOCX Formatting
 * Department, same Book Design Profile per family (lib/book-format.ts),
 * same manuscript parsing (lib/manuscript-blocks.ts), rendered as valid
 * XHTML/CSS instead of OOXML. Unlike DOCX, EPUB is reflowable — there's no
 * pagination to get right, no page numbers, no fixed page size; the
 * reading app handles layout. What has to be right instead is structure:
 * a real spine (reading order), a real EPUB3 navigation document (the
 * table of contents *is* the nav, not a separate fake list), and valid
 * package metadata. Every generated file in this module was checked
 * against the real, official EPUBCheck validator during development.
 */

export type EpubChapterInput = {
  chapterNumber: number;
  title: string | null;
  content: string;
  images: { image: LoadedImage; caption: string | null }[];
};

export type EpubInput = {
  title: string;
  subtitle: string | null;
  authorName: string | null;
  family: BookDesignFamily;
  coverImage: LoadedImage | null;
  chapters: EpubChapterInput[];
};

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function xhtmlDoc(title: string, bodyClass: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.w3.org/ns/epub" lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body class="${bodyClass}">
${bodyHtml}
</body>
</html>`;
}

function blocksToHtml(blocks: ManuscriptBlock[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "bullet") {
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === "bullet") {
        items.push(`<li>${esc((blocks[i] as { text: string }).text)}</li>`);
        i++;
      }
      parts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (block.type === "numbered") {
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === "numbered") {
        items.push(`<li>${esc((blocks[i] as { text: string }).text)}</li>`);
        i++;
      }
      parts.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    switch (block.type) {
      case "paragraph":
        parts.push(`<p>${esc(block.text)}</p>`);
        break;
      case "heading":
        parts.push(`<h${block.level}>${esc(block.text)}</h${block.level}>`);
        break;
      case "code":
        parts.push(`<pre class="code"><code>${block.lines.map(esc).join("\n")}</code></pre>`);
        break;
      case "callout": {
        const cls = `callout-${block.label.toLowerCase().replace(/\s+/g, "-")}`;
        const paras = block.lines.map((line, idx) => (idx === 0 ? `<strong>${esc(block.label)}:</strong> ${esc(line)}` : esc(line)));
        parts.push(`<div class="callout ${cls}">${paras.map((p) => `<p>${p}</p>`).join("")}</div>`);
        break;
      }
      case "quote":
        parts.push(`<blockquote><p>${esc(block.text)}</p></blockquote>`);
        break;
      case "table": {
        const [header, ...rows] = block.rows;
        const head = `<tr>${header.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
        const body = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
        parts.push(`<table><thead>${head}</thead><tbody>${body}</tbody></table>`);
        break;
      }
    }
    i++;
  }
  return parts.join("\n");
}

function chapterContentHtml(content: string, family: BookDesignFamily): string {
  if (family === "fiction") {
    return content
      .split(/\n{2,}/)
      .filter((p) => p.trim().length > 0)
      .map((p) => `<p>${esc(p.trim())}</p>`)
      .join("\n");
  }
  return blocksToHtml(parseManuscriptBlocks(content));
}

const CSS_BASE = `
body { margin: 0 5%; }
h1, h2, h3 { font-weight: bold; }
img { max-width: 100%; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #999; padding: 0.4em 0.6em; text-align: left; font-size: 0.85em; }
th { background: #e8e8e8; }
pre.code { background: #f2f2f2; padding: 0.6em; overflow-x: auto; font-family: "Courier New", monospace; font-size: 0.85em; white-space: pre-wrap; }
blockquote { border-left: 3px solid #999; margin: 1em 0; padding-left: 1em; font-style: italic; color: #444; }
.callout { border-left: 4px solid #8899AA; padding: 0.6em 1em; margin: 1em 0; }
.callout p { margin: 0.3em 0; }
.callout-note { background: #EAF2FB; }
.callout-tip { background: #EAF7EF; }
.callout-warning { background: #FCEAEA; }
.callout-important { background: #FCEAEA; }
.callout-key-takeaway { background: #FFF6E0; }
.callout-action-step { background: #F0EAFB; }
.callout-definition { background: #F2F2F2; }
.callout-example { background: #EAF7EF; }
.chapter-heading { text-align: center; font-size: 1.5em; margin-top: 2em; }
.chapter-title { text-align: center; font-style: italic; margin-bottom: 1.5em; }
.titlepage, .copyrightpage, .backmatter { text-align: center; }
.titlepage h1 { font-size: 2em; margin-top: 30%; }
figure { text-align: center; margin: 1.5em 0; }
figcaption { font-size: 0.85em; font-style: italic; color: #555; margin-top: 0.4em; }
`;

function cssForFamily(family: BookDesignFamily): string {
  if (family === "fiction") {
    return `${CSS_BASE}
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.5; }
p { text-align: justify; text-indent: 0; margin: 0; }
p + p { text-indent: 1.5em; }
`;
  }
  if (family === "childrens") {
    return `${CSS_BASE}
body { font-family: Georgia, serif; font-size: 1.15em; line-height: 1.6; }
p { text-align: left; margin: 0 0 1em; }
`;
  }
  return `${CSS_BASE}
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.5; }
h2, h3, .chapter-heading { font-family: Arial, Helvetica, sans-serif; }
p { text-align: left; margin: 0 0 1em; }
`;
}

function imageExt(image: LoadedImage): string {
  return image.type === "jpg" ? "jpg" : image.type;
}

/** Builds a real, valid EPUB 3 file and returns it as a Buffer. */
export async function buildEpubBuffer(input: EpubInput): Promise<Buffer> {
  const zip = new JSZip();
  // The mimetype entry must be first and stored uncompressed, per the EPUB spec.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
  );

  const oebps = zip.folder("OEBPS")!;
  oebps.file("styles.css", cssForFamily(input.family));

  const manifestItems: string[] = [`<item id="css" href="styles.css" media-type="text/css" />`];
  const spineItems: string[] = [];
  let figureNumber = 0;

  // ---- Cover ----
  let coverImageId: string | null = null;
  if (input.coverImage) {
    const ext = imageExt(input.coverImage);
    oebps.folder("images")!.file(`cover.${ext}`, input.coverImage.buffer);
    coverImageId = "cover-image";
    manifestItems.push(`<item id="${coverImageId}" href="images/cover.${ext}" media-type="${input.coverImage.mimeType}" properties="cover-image" />`);
    oebps.file(
      "cover.xhtml",
      xhtmlDoc(
        "Cover",
        "titlepage",
        `<div style="text-align:center;"><img src="images/cover.${ext}" alt="Cover" style="max-height:90vh;" /></div>`
      )
    );
    manifestItems.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" />`);
    spineItems.push(`<itemref idref="cover" linear="yes" />`);
  }

  // ---- Title page ----
  const titleHtml = [
    `<h1>${esc(input.title)}</h1>`,
    input.subtitle ? `<p>${esc(input.subtitle)}</p>` : "",
    input.authorName ? `<p>${esc(input.authorName)}</p>` : "",
  ].join("\n");
  oebps.file("titlepage.xhtml", xhtmlDoc(input.title, "titlepage", titleHtml));
  manifestItems.push(`<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml" />`);
  spineItems.push(`<itemref idref="titlepage" linear="yes" />`);

  // ---- Copyright page ----
  const year = new Date().getFullYear();
  const copyrightHtml = `
<p>Copyright &#169; ${year} ${esc(input.authorName || "[AUTHOR NAME]")}</p>
<p>All rights reserved.</p>
<p style="font-size:0.85em;">No part of this publication may be reproduced, distributed, or transmitted in any
form or by any means, including photocopying, recording, or other electronic or mechanical methods, without
the prior written permission of the publisher, except in the case of brief quotations embodied in critical
reviews and certain other noncommercial uses permitted by copyright law.</p>
<p style="font-size:0.85em;">Publisher: [PUBLISHER / IMPRINT]</p>
<p style="font-size:0.85em;">ISBN: [ISBN]</p>
<p style="font-size:0.85em;">First Edition</p>`;
  oebps.file("copyright.xhtml", xhtmlDoc("Copyright", "copyrightpage", copyrightHtml));
  manifestItems.push(`<item id="copyright" href="copyright.xhtml" media-type="application/xhtml+xml" />`);
  spineItems.push(`<itemref idref="copyright" linear="yes" />`);

  // ---- Chapters ----
  const navPoints: string[] = [];
  for (const chapter of input.chapters) {
    const id = `chapter-${chapter.chapterNumber}`;
    const headingText = `Chapter ${numberToWords(chapter.chapterNumber)}`;

    const imageParts: string[] = [];
    for (const { image, caption } of chapter.images) {
      figureNumber++;
      const ext = imageExt(image);
      const filename = `interior-${figureNumber}.${ext}`;
      oebps.folder("images")!.file(filename, image.buffer);
      manifestItems.push(`<item id="img-${figureNumber}" href="images/${filename}" media-type="${image.mimeType}" />`);
      const figCaption = caption ? `<figcaption>${esc(caption)}</figcaption>` : "";
      imageParts.push(`<figure><img src="images/${filename}" alt="${esc(caption ?? "Illustration")}" />${figCaption}</figure>`);
    }

    const bodyHtml = [
      `<h1 class="chapter-heading">${esc(headingText)}</h1>`,
      chapter.title ? `<p class="chapter-title">${esc(chapter.title)}</p>` : "",
      ...imageParts,
      chapterContentHtml(chapter.content, input.family),
    ]
      .filter(Boolean)
      .join("\n");

    oebps.file(`${id}.xhtml`, xhtmlDoc(headingText, "chapter", bodyHtml));
    manifestItems.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml" />`);
    spineItems.push(`<itemref idref="${id}" linear="yes" />`);
    navPoints.push(`<li><a href="${id}.xhtml">${esc(headingText)}${chapter.title ? ` — ${esc(chapter.title)}` : ""}</a></li>`);
  }

  // ---- Back matter (only when there's real data) ----
  if (input.authorName) {
    const backHtml = `
<h1>About the Author</h1>
<p><strong>${esc(input.authorName)}</strong></p>
<p><em>[Add a short author bio here.]</em></p>`;
    oebps.file("backmatter.xhtml", xhtmlDoc("About the Author", "backmatter", backHtml));
    manifestItems.push(`<item id="backmatter" href="backmatter.xhtml" media-type="application/xhtml+xml" />`);
    spineItems.push(`<itemref idref="backmatter" linear="yes" />`);
    navPoints.push(`<li><a href="backmatter.xhtml">About the Author</a></li>`);
  }

  // ---- Navigation document (EPUB3's real TOC — not a hand-typed fake one) ----
  const navHtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.w3.org/ns/epub" lang="en">
<head>
<meta charset="utf-8" />
<title>Table of Contents</title>
<link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
<nav epub:type="toc" id="toc">
<h1>Table of Contents</h1>
<ol>
${navPoints.join("\n")}
</ol>
</nav>
</body>
</html>`;
  oebps.file("nav.xhtml", navHtml);
  manifestItems.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />`);

  // ---- Package document ----
  const bookId = `urn:uuid:${randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${bookId}</dc:identifier>
    <dc:title>${esc(input.title)}</dc:title>
    ${input.subtitle ? `<dc:description>${esc(input.subtitle)}</dc:description>` : ""}
    <dc:creator>${esc(input.authorName || "Unknown")}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
    ${coverImageId ? `<meta name="cover" content="${coverImageId}" />` : ""}
  </metadata>
  <manifest>
${manifestItems.map((i) => `    ${i}`).join("\n")}
  </manifest>
  <spine>
${spineItems.map((i) => `    ${i}`).join("\n")}
  </spine>
</package>`;
  oebps.file("content.opf", opf);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return buffer;
}

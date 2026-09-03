/**
 * Converts an uploaded .docx manuscript into the same lightweight-Markdown
 * dialect the Writing Agent itself produces (lib/manuscript-blocks.ts) —
 * so an imported book flows through the exact same, already-verified
 * formatting pipeline (DOCX/EPUB) as an AI-written one, with zero new
 * rendering code. Deliberately conservative: an uploaded document with no
 * Word "Heading 1" paragraphs is imported as a single chapter rather than
 * guessed at, since a wrong automatic chapter split would scramble the
 * author's own manuscript with no easy way to notice.
 */

export type ImportedChapter = { title: string; content: string };

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Inline-level HTML (inside one block element) to the app's bold/italic emphasis markers. */
function inlineToMarkdown(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<a\s[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One chapter's HTML (mammoth's output for everything between two Word
 * "Heading 1" paragraphs, or the whole document when there's only one
 * chapter) to lightweight Markdown: h2/h3 -> ##/###, ul/ol -> -/1., p ->
 * plain paragraph, bold/italic preserved inline. mammoth's default
 * conversion never nests these block tags inside each other for ordinary
 * prose, so a single top-level pass is enough — anything else (tables,
 * images) is stripped to its text rather than silently dropped.
 */
function chapterHtmlToMarkdown(html: string): string {
  const blockPattern = /<(h[1-6]|p|ul|ol)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  const lines: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[2];
    if (tag === "ul" || tag === "ol") {
      const items = [...inner.matchAll(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi)];
      items.forEach((item, i) => {
        const text = inlineToMarkdown(item[1]);
        if (text) lines.push(tag === "ul" ? `- ${text}` : `${i + 1}. ${text}`);
      });
    } else if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]) <= 2 ? 2 : 3;
      const text = inlineToMarkdown(inner);
      if (text) lines.push(`${"#".repeat(level)} ${text}`);
    } else {
      const text = inlineToMarkdown(inner);
      if (text) lines.push(text);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Splits mammoth's full-document HTML on Word "Heading 1" paragraphs — the
 * convention this app's own exports use for a chapter-opening title, and
 * the one most manuscripts already use for chapter breaks. No <h1> found
 * anywhere -> the whole document becomes one chapter (see the module doc
 * comment for why this is the safe default rather than a guess).
 */
export function splitIntoChapters(html: string, fallbackTitle: string): ImportedChapter[] {
  const h1Pattern = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/gi;
  const marks: { start: number; end: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = h1Pattern.exec(html)) !== null) {
    marks.push({ start: m.index, end: h1Pattern.lastIndex, title: stripTags(m[1]) || fallbackTitle });
  }

  if (marks.length === 0) {
    const content = chapterHtmlToMarkdown(html);
    return content ? [{ title: fallbackTitle, content }] : [];
  }

  const chapters: ImportedChapter[] = [];
  for (let i = 0; i < marks.length; i++) {
    const sectionStart = marks[i].end;
    const sectionEnd = i + 1 < marks.length ? marks[i + 1].start : html.length;
    const content = chapterHtmlToMarkdown(html.slice(sectionStart, sectionEnd));
    if (content) chapters.push({ title: marks[i].title, content });
  }
  return chapters;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

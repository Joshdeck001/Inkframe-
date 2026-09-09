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
/**
 * `plainHeadings` renders h1-h6 as bare text lines instead of "## "
 * Markdown — used by the no-"Heading 1" fallback in splitIntoChapters,
 * where headings need to stay recognizable to the plain-text chapter
 * detector rather than already-committed to a Markdown heading level.
 */
function chapterHtmlToMarkdown(html: string, plainHeadings = false): string {
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
      if (text) lines.push(plainHeadings ? text : `${"#".repeat(level)} ${text}`);
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
    const plainText = chapterHtmlToMarkdown(html, true);
    return plainText ? detectChaptersFromPlainText(plainText, fallbackTitle) : [];
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

export function charCount(text: string): number {
  return text.replace(/\s+/g, "").length;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/** "twenty-three" / "twenty three" -> 23. Returns null for anything it doesn't recognize rather than guessing. */
function wordToNumber(raw: string): number | null {
  const words = raw.toLowerCase().trim().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return null;
  if (words.length === 1) return WORD_NUMBERS[words[0]] ?? null;
  const tens = WORD_NUMBERS[words[0]];
  const ones = WORD_NUMBERS[words[1]];
  if (tens === undefined || tens % 10 !== 0 || ones === undefined || ones >= 10) return null;
  return tens + ones;
}

/**
 * Reads a chapter's ordinal from its detected title ("Chapter 7", "Chapter
 * Seven", "CHAPTER 07", "Ch. 7", "7. The Beginning" -> 7). Returns null for
 * titles with no recognizable number rather than guessing — callers must
 * treat null as "unknown position", never as "chapter 0".
 */
export function parseChapterNumber(title: string): number | null {
  const t = title.trim();
  let m = t.match(/^chapter\s+(\d+)\b/i);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^ch\.?\s*(\d+)\b/i);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^chapter\s+([a-z][a-z\s-]*?)(?:[:\-—.]|$)/i);
  if (m) {
    const n = wordToNumber(m[1]);
    if (n !== null) return n;
  }
  m = t.match(/^(\d+)[.):\-—]/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** One recognized chapter-heading line: how many chars it spans and the title text to use. */
type HeadingMatch = { title: string };

/**
 * Recognizes a line as a chapter (or part) heading. Deliberately only
 * matches short, heading-shaped lines — "Chapter 1", "CHAPTER ONE",
 * "Ch. 4", "Chapter 12: The Escape", "Part One" — never a bare number
 * pattern like "1. Title" on its own, since that collides with ordinary
 * numbered-list prose too often to trust without the surrounding blank
 * lines the caller also checks for.
 */
function matchHeadingLine(line: string): HeadingMatch | null {
  const t = line.trim();
  if (!t || t.length > 90) return null;
  if (/^(chapter|ch\.?)\s+([a-z0-9][a-z0-9\s-]*)/i.test(t)) return { title: t.replace(/\s+/g, " ") };
  if (/^part\s+([a-z0-9][a-z0-9\s-]*)/i.test(t)) return { title: t.replace(/\s+/g, " ") };
  if (/^(prologue|epilogue|introduction|foreword|preface|afterword|acknowledgments|acknowledgements|dedication|epigraph|author'?s?\s+note|about\s+the\s+author)\s*$/i.test(t))
    return { title: t.replace(/\s+/g, " ") };
  return null;
}

/** Same recognition as matchHeadingLine, but for the bare "1. Title" / "1 — Title" form, which needs blank-line isolation to be trusted. */
function matchBareNumberHeading(line: string): HeadingMatch | null {
  const t = line.trim();
  if (!t || t.length > 90) return null;
  if (/^\d{1,3}[.)]\s+\S/.test(t) || /^\d{1,3}\s*[—-]\s*\S/.test(t)) return { title: t.replace(/\s+/g, " ") };
  return null;
}

/**
 * Deterministic, pattern-based chapter splitter for plain text (no Word
 * styles to lean on) — used for .txt uploads, pasted text, and as the
 * fallback for .docx files with no "Heading 1" paragraphs. Recognizes
 * "Chapter 1" / "Chapter One" / "CHAPTER 1" / "Ch. 4" / "Chapter 12: Title"
 * / "Part One" / named front/back-matter labels on their own line, and the
 * bare "1. Title" form only when isolated by blank lines (see
 * matchBareNumberHeading). A heading line found with no chapter content
 * before it becomes a chapter title; text before the first detected
 * heading is kept, never discarded, as a leading chapter using
 * fallbackTitle — nothing the source contained is ever silently dropped.
 * "Part"/front-matter-label lines are folded into the *next* chapter's
 * content as a "## " sub-heading rather than becoming their own empty
 * chapter, since there's no schema slot for a bare structural divider.
 */
export function detectChaptersFromPlainText(text: string, fallbackTitle: string): ImportedChapter[] {
  const lines = text.split(/\r?\n/);
  type Block = { title: string | null; isDivider: boolean; bodyLines: string[] };
  const blocks: Block[] = [{ title: null, isDivider: false, bodyLines: [] }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isolated = (lines[i - 1] ?? "").trim() === "" && (lines[i + 1] ?? "").trim() === "";
    const heading = matchHeadingLine(line) ?? (isolated ? matchBareNumberHeading(line) : null);
    if (heading) {
      const isDivider = /^part\s+/i.test(heading.title);
      blocks.push({ title: heading.title, isDivider, bodyLines: [] });
    } else {
      blocks[blocks.length - 1].bodyLines.push(line);
    }
  }

  const chapters: ImportedChapter[] = [];
  let pendingDividers: string[] = [];
  for (const block of blocks) {
    const body = block.bodyLines.join("\n").trim();
    if (block.title && block.isDivider) {
      // Fold into the next real chapter's content instead of becoming an empty chapter of its own.
      if (body) pendingDividers.push(`## ${block.title}\n\n${body}`);
      else pendingDividers.push(`## ${block.title}`);
      continue;
    }
    const content = [...pendingDividers, body].filter(Boolean).join("\n\n");
    pendingDividers = [];
    if (!content) continue;
    chapters.push({ title: block.title ?? fallbackTitle, content });
  }
  return chapters;
}

export type ContentIntegrity = {
  sourceWords: number;
  sourceChars: number;
  assembledWords: number;
  assembledChars: number;
};

/**
 * Reports source vs. assembled size so the review screen can show the
 * author their content wasn't rewritten — not a byte-perfect diff (heading
 * lines are deliberately promoted to chapter titles and stripped from the
 * body, which legitimately shrinks the assembled count a little), but any
 * gap larger than the detected headings account for is visible here rather
 * than hidden.
 */
export function computeIntegrity(sourceText: string, chapters: ImportedChapter[]): ContentIntegrity {
  return {
    sourceWords: wordCount(sourceText),
    sourceChars: charCount(sourceText),
    assembledWords: chapters.reduce((sum, c) => sum + wordCount(c.content), 0),
    assembledChars: chapters.reduce((sum, c) => sum + charCount(c.content), 0),
  };
}

export type ImportIssues = {
  missingNumbers: number[];
  duplicates: { aIndex: number; bIndex: number }[];
  multipleVersions: { number: number; indices: number[] }[];
};

/**
 * Flags gaps in chapter numbering, exact (whitespace-normalized) duplicate
 * chapters, and — importantly for ChatGPT-sourced text — same-numbered
 * chapters with *different* content. That last case is the common
 * "write Chapter 5, then ask for a rewrite as a follow-up message"
 * pattern: unlike a true edit/regenerate (a branch fork that
 * extractChatGPTConversationText already resolves via current_node), a
 * follow-up "rewrite this" turn is just another linear assistant message,
 * so both the draft and the rewrite land in the text and both get detected
 * as "Chapter 5". Never auto-picks one — surfaced so the author removes
 * the draft they don't want on the review screen.
 */
export function detectIssues(chapters: ImportedChapter[]): ImportIssues {
  const numbered = chapters
    .map((c, i) => ({ i, n: parseChapterNumber(c.title) }))
    .filter((x): x is { i: number; n: number } => x.n !== null);
  const missingNumbers: number[] = [];
  if (numbered.length > 1) {
    const nums = numbered.map((x) => x.n).sort((a, b) => a - b);
    for (let n = nums[0]; n < nums[nums.length - 1]; n++) {
      if (!nums.includes(n)) missingNumbers.push(n);
    }
  }

  const byNumber = new Map<number, number[]>();
  for (const { i, n } of numbered) byNumber.set(n, [...(byNumber.get(n) ?? []), i]);
  const multipleVersions = [...byNumber.entries()]
    .filter(([, indices]) => indices.length > 1)
    .map(([number, indices]) => ({ number, indices }));

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const duplicates: { aIndex: number; bIndex: number }[] = [];
  for (let a = 0; a < chapters.length; a++) {
    for (let b = a + 1; b < chapters.length; b++) {
      if (chapters[a].content && normalize(chapters[a].content) === normalize(chapters[b].content)) {
        duplicates.push({ aIndex: a, bIndex: b });
      }
    }
  }
  return { missingNumbers, duplicates, multipleVersions };
}

// ---------------------------------------------------------------------------
// ChatGPT conversations.json export (Settings -> Data Controls -> Export in
// ChatGPT itself — an official, user-authorized download, never a scrape of
// chatgpt.com). Structure: each conversation has a `mapping` of node id ->
// {message, parent, children} forming a tree (branches happen on every
// edit/regenerate), plus `current_node`, which is the leaf of whichever
// branch was last active — i.e. exactly the "final version" the spec asks
// for, already decided by the export itself with no guessing required.
// ---------------------------------------------------------------------------

type ChatGPTNode = {
  id?: string;
  message?: {
    author?: { role?: string };
    content?: { content_type?: string; parts?: unknown[] };
  } | null;
  parent?: string | null;
};

type ChatGPTConversation = {
  title?: string;
  mapping?: Record<string, ChatGPTNode>;
  current_node?: string;
};

export type ChatGPTConversationSummary = { index: number; title: string; assistantWords: number };

function assistantTextAlongFinalBranch(conv: ChatGPTConversation): string {
  const mapping = conv.mapping;
  if (!mapping || !conv.current_node) return "";
  const path: string[] = [];
  let nodeId: string | undefined = conv.current_node;
  const seen = new Set<string>();
  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    path.push(nodeId);
    nodeId = mapping[nodeId].parent ?? undefined;
  }
  path.reverse();

  const parts: string[] = [];
  for (const id of path) {
    const message = mapping[id]?.message;
    if (!message || message.author?.role !== "assistant") continue;
    if (message.content?.content_type !== "text") continue;
    const text = (message.content.parts ?? [])
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

/** Parses and validates the top-level shape only — throws a plain, user-facing message on anything else, never a stack trace. */
export function parseChatGPTExport(raw: string): ChatGPTConversation[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("That doesn't look like a valid conversations.json file — it isn't valid JSON.");
  }
  if (!Array.isArray(data)) {
    throw new Error(
      "That doesn't look like a ChatGPT conversations.json export — expected a JSON array of conversations."
    );
  }
  return data as ChatGPTConversation[];
}

export function listChatGPTConversations(conversations: ChatGPTConversation[]): ChatGPTConversationSummary[] {
  return conversations.map((conv, index) => ({
    index,
    title: typeof conv.title === "string" && conv.title.trim() ? conv.title.trim() : `Untitled conversation ${index + 1}`,
    assistantWords: wordCount(assistantTextAlongFinalBranch(conv)),
  }));
}

/** The chosen conversation's final-branch assistant text, ready to run through detectChaptersFromPlainText. */
export function extractChatGPTConversationText(conversations: ChatGPTConversation[], index: number): string {
  const conv = conversations[index];
  if (!conv) throw new Error("That conversation index was not found in this export.");
  return assistantTextAlongFinalBranch(conv);
}

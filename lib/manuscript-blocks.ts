/**
 * Parses the Writing Agent's lightweight-Markdown chapter content
 * (structured book families only — see lib/book-format.ts) into a
 * format-neutral block AST: headings, paragraphs, bullet/numbered list
 * items, fenced code blocks, '> LABEL: text' callouts, plain '> text'
 * block quotations, and pipe-table syntax. Both lib/formatting-department.ts
 * (DOCX) and lib/epub-builder.ts (EPUB) render this same AST into their
 * own output format, so a parsing fix or a new syntax only ever needs to
 * happen once and both formats stay in sync.
 */

export const CALLOUT_LABELS = [
  "NOTE", "TIP", "WARNING", "IMPORTANT", "KEY TAKEAWAY", "ACTION STEP", "DEFINITION", "EXAMPLE",
] as const;
export type CalloutLabel = (typeof CALLOUT_LABELS)[number];

const CALLOUT_PATTERN = new RegExp(`^>\\s*(${CALLOUT_LABELS.join("|")}):\\s*(.*)`);

export type ManuscriptBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "bullet"; text: string }
  | { type: "numbered"; marker: string; text: string }
  | { type: "code"; lines: string[] }
  | { type: "callout"; label: CalloutLabel; lines: string[] }
  | { type: "quote"; text: string }
  | { type: "table"; rows: string[][] };

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

export function parseManuscriptBlocks(content: string): ManuscriptBlock[] {
  const blocks: ManuscriptBlock[] = [];
  let textBuffer: string[] = [];
  let codeBuffer: string[] | null = null;
  let calloutLines: { label: CalloutLabel; text: string }[] | null = null;
  let tableRows: string[][] | null = null;

  const flushText = () => {
    const text = textBuffer.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    textBuffer = [];
  };
  const flushCallout = () => {
    if (calloutLines && calloutLines.length > 0) {
      blocks.push({
        type: "callout",
        label: calloutLines[0].label,
        lines: calloutLines.map((l) => l.text),
      });
    }
    calloutLines = null;
  };
  const flushTable = () => {
    if (tableRows && tableRows.length >= 2) blocks.push({ type: "table", rows: tableRows });
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
        blocks.push({ type: "code", lines: codeBuffer });
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
      blocks.push({ type: "quote", text: quoteMatch[1] });
      continue;
    }

    const heading3 = line.match(/^###\s+(.*)/);
    const heading2 = !heading3 && line.match(/^##\s+(.*)/);
    const bullet = line.match(/^[-*]\s+(.*)/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)/);

    if (heading2 || heading3) {
      flushText();
      const [, text] = (heading2 || heading3) as RegExpMatchArray;
      blocks.push({ type: "heading", level: heading2 ? 2 : 3, text });
    } else if (bullet) {
      flushText();
      blocks.push({ type: "bullet", text: bullet[1] });
    } else if (numbered) {
      flushText();
      blocks.push({ type: "numbered", marker: numbered[1], text: numbered[2] });
    } else if (line.trim().length === 0) {
      flushText();
    } else {
      textBuffer.push(line.trim());
    }
  }
  flushText();
  flushCallout();
  flushTable();
  return blocks;
}

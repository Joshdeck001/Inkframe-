import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { createClient } from "@/lib/supabase/server";
import { withJsonErrors } from "@/lib/api-guard";
import {
  splitIntoChapters,
  detectChaptersFromPlainText,
  computeIntegrity,
  detectIssues,
  wordCount,
  parseChatGPTExport,
  listChatGPTConversations,
  extractChatGPTConversationText,
  type ImportedChapter,
} from "@/lib/manuscript-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;
const SOURCES = ["docx", "txt", "chatgpt_export"] as const;
const FALLBACK_TITLE = "Full Manuscript";

/**
 * Step 1 of the (now two-step) import flow: turns an uploaded file into a
 * proposed chapter list for the author to review/reorder/rename before any
 * project is created — nothing is written to the database here. Kept
 * separate from the "create" route so a ChatGPT export's conversation
 * picker and the review screen both have something to show before
 * committing to a project. No AI model is called anywhere in this route —
 * every split is deterministic pattern-matching over the source text, per
 * the "extraction, not rewriting" rule this feature exists to enforce.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const formData = await request.formData();
  const file = formData.get("file");
  const source = formData.get("source");
  const conversationIndexRaw = formData.get("conversation_index");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 20MB or smaller." }, { status: 400 });
  }
  if (typeof source !== "string" || !SOURCES.includes(source as (typeof SOURCES)[number])) {
    return NextResponse.json({ error: "An import source must be specified." }, { status: 400 });
  }

  let sourceText: string;
  let chapters: ImportedChapter[];

  if (source === "docx") {
    let html: string;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
    } catch (e) {
      return NextResponse.json(
        { error: `Could not read that file — is it a real .docx? (${e instanceof Error ? e.message : String(e)})` },
        { status: 400 }
      );
    }
    chapters = splitIntoChapters(html, FALLBACK_TITLE);
    sourceText = html.replace(/<[^>]+>/g, " ");
  } else if (source === "txt") {
    sourceText = Buffer.from(await file.arrayBuffer()).toString("utf-8");
    chapters = detectChaptersFromPlainText(sourceText, FALLBACK_TITLE);
  } else {
    const raw = Buffer.from(await file.arrayBuffer()).toString("utf-8");
    let conversations;
    try {
      conversations = parseChatGPTExport(raw);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read that export." }, { status: 400 });
    }

    if (typeof conversationIndexRaw !== "string") {
      const conversationList = listChatGPTConversations(conversations).filter((c) => c.assistantWords > 0);
      if (conversationList.length === 0) {
        return NextResponse.json(
          { error: "No conversations with assistant replies were found in this export." },
          { status: 400 }
        );
      }
      return NextResponse.json({ needsConversationPick: true, conversations: conversationList });
    }

    const conversationIndex = parseInt(conversationIndexRaw, 10);
    try {
      sourceText = extractChatGPTConversationText(conversations, conversationIndex);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read that conversation." }, { status: 400 });
    }
    chapters = detectChaptersFromPlainText(sourceText, FALLBACK_TITLE);
  }

  if (chapters.length === 0) {
    return NextResponse.json({ error: "No readable text was found in that source." }, { status: 400 });
  }

  return NextResponse.json({
    chapters: chapters.map((c) => ({ title: c.title, content: c.content, words: wordCount(c.content) })),
    integrity: computeIntegrity(sourceText, chapters),
    issues: detectIssues(chapters),
  });
});

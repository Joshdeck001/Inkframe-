import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } from "docx";

type TranslatedOutput = {
  language: string;
  title: string;
  subtitle: string;
  description: string;
  file_ref: string | null;
  word_count: number;
  // Internal bookkeeping to resume a language across ticks — not part of
  // the documented schema shape, harmless extra fields on the jsonb row.
  _unitIndex?: number;
  _unitTranslations?: string[];
};

type TranslationUnit = { label: string; content: string };

function chunkText(text: string, wordsPerChunk = 2500): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  }
  return chunks.length > 0 ? chunks : [""];
}

/**
 * Resolves what to translate: real chapters for an existing InkFrame
 * project (clean boundaries, already known titles), or word-count chunks
 * of extracted text for an uploaded .docx (no chapter structure to rely on).
 * Uploaded PDF/EPUB aren't supported yet — callers should check first.
 */
async function resolveSource(
  supabase: SupabaseClient,
  job: { source_project_id: string | null; source_file: string | null }
): Promise<{ title: string; subtitle: string; description: string; units: TranslationUnit[] } | null> {
  if (job.source_project_id) {
    const [{ data: identity }, { data: metadata }, { data: chapters }] = await Promise.all([
      supabase.from("project_identity").select("working_title, subtitle").eq("project_id", job.source_project_id).single(),
      supabase.from("metadata_department").select("description_long").eq("project_id", job.source_project_id).maybeSingle(),
      supabase
        .from("chapters")
        .select("chapter_number, title, content")
        .eq("project_id", job.source_project_id)
        .order("chapter_number", { ascending: true }),
    ]);
    return {
      title: identity?.working_title || "Untitled",
      subtitle: identity?.subtitle || "",
      description: metadata?.description_long || "",
      units: (chapters ?? []).map((c) => ({ label: `Chapter ${c.chapter_number}: ${c.title}`, content: c.content })),
    };
  }

  if (job.source_file) {
    if (!job.source_file.toLowerCase().endsWith(".docx")) return null; // unsupported format
    const service = supabase; // caller passes a service-role client for storage access
    const { data: blob, error } = await service.storage.from("uploads").download(job.source_file);
    if (error || !blob) throw new Error(error?.message || "Could not download the uploaded manuscript.");
    const buffer = Buffer.from(await blob.arrayBuffer());
    const { value: text } = await mammoth.extractRawText({ buffer });
    const filename = job.source_file.split("/").pop() || "Untitled";
    return {
      title: filename.replace(/\.docx$/i, ""),
      subtitle: "",
      description: "",
      units: chunkText(text).map((content, i) => ({ label: `Part ${i + 1}`, content })),
    };
  }

  return null;
}

async function translateFrontMatter(anthropic: Anthropic, language: string, title: string, subtitle: string, description: string) {
  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 1500,
    system: `Translate the following book title, subtitle, and description into ${language}. Preserve tone and marketability — this is not a literal word-for-word translation, it should read naturally to a native ${language} reader. Respond with exactly three lines: the translated title, then the translated subtitle (blank line if none), then the translated description.`,
    messages: [{ role: "user", content: `Title: ${title}\nSubtitle: ${subtitle}\nDescription: ${description}` }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  const [translatedTitle = title, translatedSubtitle = "", ...rest] = text.split("\n").filter((l, i) => i === 0 || l.trim() !== "" || i > 1);
  return { title: translatedTitle.trim(), subtitle: translatedSubtitle.trim(), description: rest.join("\n").trim() };
}

async function translateUnit(anthropic: Anthropic, language: string, content: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    system: `Translate the following book text into ${language}. Preserve meaning, tone, and paragraph structure — this is a professional literary translation, not a literal word-for-word conversion. Output ONLY the translated text.`,
    messages: [{ role: "user", content }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : content;
}

async function assembleAndUpload(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  language: string,
  title: string,
  subtitle: string,
  unitTranslations: string[]
): Promise<{ path: string; wordCount: number }> {
  const paragraphs = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    ...(subtitle ? [new Paragraph({ text: subtitle, heading: HeadingLevel.HEADING_2 })] : []),
    new Paragraph({ children: [new PageBreak()] }),
    ...unitTranslations.flatMap((unit) => [
      ...unit
        .split(/\n{2,}/)
        .filter((p) => p.trim().length > 0)
        .map((p) => new Paragraph({ children: [new TextRun(p.trim())], spacing: { after: 200 } })),
      new Paragraph({ children: [new PageBreak()] }),
    ]),
  ];
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const buffer = await Packer.toBuffer(doc);
  const path = `${userId}/${jobId}/${language}.docx`;

  const { error } = await supabase.storage.from("exports").upload(path, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const wordCount = unitTranslations.reduce((s, u) => s + u.split(/\s+/).filter(Boolean).length, 0);
  return { path, wordCount };
}

/** One tick: advances exactly one unit (one chapter, or one chunk of an upload) of one language of one job. */
export async function runTranslationDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const { data: job, error: jobQueryError } = await supabase
    .from("translation_jobs")
    .select("*")
    .in("status", ["pending", "translating"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (jobQueryError) throw new Error(`Could not query translation_jobs: ${jobQueryError.message}`);
  if (!job) return { processed: false, detail: "No translation jobs waiting." };

  let userId: string | null = null;
  if (job.source_project_id) {
    const { data: project } = await supabase.from("projects").select("user_id").eq("id", job.source_project_id).single();
    userId = project?.user_id ?? null;
  }
  if (!userId && job.source_file) {
    userId = job.source_file.split("/")[0];
  }
  if (!userId) {
    await supabase.from("translation_jobs").update({ status: "failed" }).eq("id", job.id);
    return { processed: true, detail: `Job ${job.id}: could not resolve an owner, marked failed.` };
  }

  const source = await resolveSource(supabase, job);
  if (!source) {
    await supabase.from("translation_jobs").update({ status: "failed" }).eq("id", job.id);
    return { processed: true, detail: `Job ${job.id}: unsupported source (only existing projects and .docx uploads are translated so far), marked failed.` };
  }

  const outputs: TranslatedOutput[] = job.translated_outputs ?? [];
  const nextLanguage = (job.target_languages as string[]).find(
    (lang) => !outputs.find((o) => o.language === lang && o.file_ref)
  );

  if (!nextLanguage) {
    await supabase
      .from("translation_jobs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    return { processed: true, detail: `Job ${job.id}: all languages complete.` };
  }

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let entry = outputs.find((o) => o.language === nextLanguage);
  if (!entry) {
    const frontMatter = await translateFrontMatter(anthropic, nextLanguage, source.title, source.subtitle, source.description);
    entry = { language: nextLanguage, ...frontMatter, file_ref: null, word_count: 0, _unitIndex: 0, _unitTranslations: [] };
    outputs.push(entry);
  } else if (entry._unitIndex === undefined) {
    entry._unitIndex = 0;
    entry._unitTranslations = [];
  }

  if (source.units.length === 0 || entry._unitIndex! >= source.units.length) {
    const { path, wordCount } = await assembleAndUpload(
      supabase,
      userId,
      job.id,
      nextLanguage,
      entry.title,
      entry.subtitle,
      entry._unitTranslations ?? []
    );
    entry.file_ref = path;
    entry.word_count = wordCount;
  } else {
    const unit = source.units[entry._unitIndex!];
    const translated = await translateUnit(anthropic, nextLanguage, unit.content);
    entry._unitTranslations = [...(entry._unitTranslations ?? []), translated];
    entry._unitIndex = entry._unitIndex! + 1;
  }

  await supabase
    .from("translation_jobs")
    .update({ status: "translating", translated_outputs: outputs, model_used: "claude-opus-5" })
    .eq("id", job.id);

  return {
    processed: true,
    detail: entry.file_ref
      ? `Job ${job.id}: ${nextLanguage} translation assembled and uploaded.`
      : `Job ${job.id}: translated unit ${entry._unitIndex}/${source.units.length} for ${nextLanguage}.`,
  };
}

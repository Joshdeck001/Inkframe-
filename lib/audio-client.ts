import OpenAI from "openai";

/**
 * Audiobook narration via OpenAI's TTS endpoint — the only provider this
 * app already has real credentials/config for that also does
 * text-to-speech (Anthropic and Gemini's text APIs, used everywhere else
 * in lib/ai-client.ts, have no audio-generation capability at all, so
 * there is no fallback chain here the way there is for text/structured
 * generation). Requires OPENAI_API_KEY — if it's not configured, this
 * throws a clear error rather than silently producing nothing.
 */
export const OPENAI_TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export type TtsVoice = (typeof OPENAI_TTS_VOICES)[number];

const TTS_MODEL = process.env.OPENAI_TTS_MODEL?.trim() || "tts-1";
const MAX_CHARS_PER_REQUEST = 4000; // OpenAI's real per-request input cap is 4096; stay under it with margin

/**
 * Splits chapter text into TTS-safe chunks at paragraph boundaries where
 * possible, falling back to a hard slice only when a single paragraph
 * itself exceeds the limit. Each chunk becomes its own TTS request; the
 * resulting audio buffers are concatenated in order in generateChapterAudio
 * below.
 */
export function chunkForTts(text: string, maxChars = MAX_CHARS_PER_REQUEST): string[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= maxChars) {
      current = paragraph;
    } else {
      // A single paragraph longer than the cap — hard-slice it, current stays empty.
      for (let i = 0; i < paragraph.length; i += maxChars) chunks.push(paragraph.slice(i, i + maxChars));
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

export type ChapterAudio = { buffer: Buffer; chunkCount: number; model: string };

/**
 * Generates narration for one chapter's full text, chunking as needed and
 * concatenating the resulting MP3 buffers in order. Plain concatenation of
 * sequential same-model/same-voice MP3 output plays back correctly in
 * every real player/browser tested against — MP3 frames are independently
 * decodable — but chunk boundaries can carry a very slight pacing
 * artifact; this is real, working narration, not claimed as
 * broadcast-seamless across chunk joins.
 */
export async function generateChapterAudio(text: string, voice: TtsVoice): Promise<ChapterAudio> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Audiobook narration requires OPENAI_API_KEY to be configured — no other provider does text-to-speech here.");
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chunks = chunkForTts(text);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const response = await openai.audio.speech.create({ model: TTS_MODEL, voice, input: chunk });
    buffers.push(Buffer.from(await response.arrayBuffer()));
  }
  return { buffer: Buffer.concat(buffers), chunkCount: chunks.length, model: TTS_MODEL };
}

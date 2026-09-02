import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";

/**
 * Real cover-art generation — OpenAI first, then Gemini. Claude has no
 * image-generation capability at all, so it's never part of this fallback
 * (unlike lib/ai-client.ts's text/structured chain, which does include it).
 * Same time-budget discipline as lib/ai-client.ts, for the same reason: an
 * SDK's own long default timeout must never be allowed to blow through
 * Vercel's function duration limit.
 */

export type ImageProvider = "openai" | "gemini";
export type ImageResult = { buffer: Buffer; mimeType: string; provider: ImageProvider; model: string };

const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.5-flash-image";

const OVERALL_BUDGET_MS = 50000;
const MIN_ATTEMPT_MS = 8000;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function openaiImage(prompt: string, size: string, timeoutMs: number, format: "png" | "jpeg"): Promise<ImageResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: timeoutMs });
  const response = await withTimeout(
    openai.images.generate({ model: OPENAI_IMAGE_MODEL, prompt, size: size as never, n: 1, output_format: format }),
    timeoutMs,
    "OpenAI"
  );
  const b64 = "data" in response ? response.data?.[0]?.b64_json : undefined;
  if (!b64) throw new Error("OpenAI did not return image data.");
  return {
    buffer: Buffer.from(b64, "base64"),
    mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
    provider: "openai",
    model: OPENAI_IMAGE_MODEL,
  };
}

async function geminiImage(prompt: string, timeoutMs: number): Promise<ImageResult> {
  // generateImages() (the Imagen-family endpoint) is deprecated and, per
  // Google's own error, only works on Vertex AI/Enterprise, not a plain
  // Gemini API key — generateContent() with an image-output model + forced
  // IMAGE response modality is the current, actually-working path.
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await withTimeout(
    ai.models.generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: prompt,
      config: { responseModalities: [Modality.IMAGE], httpOptions: { timeout: timeoutMs } },
    }),
    timeoutMs,
    "Gemini"
  );
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Gemini did not return image data.");
  return {
    buffer: Buffer.from(part.inlineData.data, "base64"),
    mimeType: part.inlineData.mimeType || "image/png",
    provider: "gemini",
    model: GEMINI_IMAGE_MODEL,
  };
}

export async function generateImage(opts: { prompt: string; size?: string; format?: "png" | "jpeg" }): Promise<ImageResult> {
  const size = opts.size ?? "1024x1024";
  // Only OpenAI's gpt-image-1 supports choosing the output format; Gemini's
  // image-output mode always returns whatever format it returns (PNG in
  // practice) with no equivalent parameter, so a jpeg request only actually
  // takes effect when OpenAI serves it — the real mimeType returned always
  // reflects what was actually generated, never a guess.
  const format = opts.format ?? "png";
  const errors: string[] = [];
  const deadline = Date.now() + OVERALL_BUDGET_MS;

  if (process.env.OPENAI_API_KEY) {
    const timeLeft = deadline - Date.now();
    if (timeLeft >= MIN_ATTEMPT_MS) {
      try {
        return await openaiImage(opts.prompt, size, timeLeft, format);
      } catch (e) {
        errors.push(`openai: ${errorMessage(e)}`);
      }
    } else {
      errors.push("openai: skipped, out of time budget");
    }
  }

  if (process.env.GEMINI_API_KEY) {
    const timeLeft = deadline - Date.now();
    if (timeLeft >= MIN_ATTEMPT_MS) {
      try {
        return await geminiImage(opts.prompt, timeLeft);
      } catch (e) {
        errors.push(`gemini: ${errorMessage(e)}`);
      }
    } else {
      errors.push("gemini: skipped, out of time budget");
    }
  }

  if (errors.length === 0) {
    throw new Error("No image-generation provider is configured (set OPENAI_API_KEY or GEMINI_API_KEY).");
  }
  throw new Error(`All configured image providers failed — ${errors.join(" | ")}`);
}

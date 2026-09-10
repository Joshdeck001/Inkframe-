import type { SupabaseClient } from "@supabase/supabase-js";
import { OpenAIImageProvider } from "@/lib/openai-image-provider";
import { GeminiImageProvider } from "@/lib/gemini-image-provider";
import type { ImageGenerationRequest, ImageEditRequest, ImageGenerationResult } from "@/lib/image-provider";

/**
 * The one place Cover Designer code calls an image-generation provider —
 * never OpenAI/Gemini directly. Generation tries OpenAI then falls back
 * to Gemini (same provider order as lib/image-client.ts, which stays
 * untouched and keeps serving interior/manuscript images unaffected by
 * this file). Editing only ever tries OpenAI, since Gemini's provider
 * honestly declares it unsupported rather than silently generating from
 * scratch and calling that an edit. Every attempt — success or failure —
 * is logged to image_generation_log with whatever real usage numbers the
 * provider actually returned.
 */

type LogContext = { projectId: string | null; userId: string };

async function logAttempt(
  supabase: SupabaseClient,
  ctx: LogContext,
  operation: "generate" | "edit",
  provider: string,
  model: string,
  opts: { quality?: string; size?: string; inputImageCount?: number },
  outcome: { status: "success"; usage?: { imageTokens?: number; textTokens?: number } } | { status: "failed"; error: string }
) {
  await supabase.from("image_generation_log").insert({
    project_id: ctx.projectId,
    user_id: ctx.userId,
    provider,
    model,
    operation,
    quality: opts.quality ?? null,
    requested_size: opts.size ?? null,
    input_image_count: opts.inputImageCount ?? 0,
    status: outcome.status,
    error: outcome.status === "failed" ? outcome.error : null,
    image_tokens: outcome.status === "success" ? (outcome.usage?.imageTokens ?? null) : null,
    text_tokens: outcome.status === "success" ? (outcome.usage?.textTokens ?? null) : null,
  });
}

export async function generateCoverArt(
  supabase: SupabaseClient,
  ctx: LogContext,
  req: ImageGenerationRequest
): Promise<ImageGenerationResult> {
  const errors: string[] = [];

  if (process.env.OPENAI_API_KEY) {
    const provider = new OpenAIImageProvider();
    try {
      const result = await provider.generateImage(req);
      await logAttempt(supabase, ctx, "generate", "openai", result.model, { quality: req.quality, size: req.size }, { status: "success", usage: result.usage });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`openai: ${message}`);
      await logAttempt(supabase, ctx, "generate", "openai", "unknown", { quality: req.quality, size: req.size }, { status: "failed", error: message });
    }
  }

  if (process.env.GEMINI_API_KEY) {
    const provider = new GeminiImageProvider();
    try {
      const result = await provider.generateImage(req);
      await logAttempt(supabase, ctx, "generate", "gemini", result.model, { size: req.size }, { status: "success" });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`gemini: ${message}`);
      await logAttempt(supabase, ctx, "generate", "gemini", "unknown", { size: req.size }, { status: "failed", error: message });
    }
  }

  if (errors.length === 0) throw new Error("No image-generation provider is configured (set OPENAI_API_KEY or GEMINI_API_KEY).");
  throw new Error(`All configured image providers failed — ${errors.join(" | ")}`);
}

export async function editCoverArt(
  supabase: SupabaseClient,
  ctx: LogContext,
  req: ImageEditRequest
): Promise<ImageGenerationResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("AI cover editing requires OPENAI_API_KEY — Gemini doesn't support reference-image editing in this app.");
  }
  const provider = new OpenAIImageProvider();
  try {
    const result = await provider.editImage(req);
    await logAttempt(
      supabase,
      ctx,
      "edit",
      "openai",
      result.model,
      { quality: req.quality, size: req.size, inputImageCount: req.images.length },
      { status: "success", usage: result.usage }
    );
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logAttempt(
      supabase,
      ctx,
      "edit",
      "openai",
      "unknown",
      { quality: req.quality, size: req.size, inputImageCount: req.images.length },
      { status: "failed", error: message }
    );
    throw new Error(`AI cover editing failed: ${message}`);
  }
}

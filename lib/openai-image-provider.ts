import OpenAI from "openai";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageGenerationResult,
  ImageProviderCapabilities,
} from "@/lib/image-provider";

/**
 * The real OpenAI GPT Image provider — see lib/image-provider.ts's top
 * comment for the model-name correction (no "gpt-image-2.5-sunburst"/
 * "-flare" exist; verified against the installed `openai` SDK's own type
 * definitions, v7.8.0). `quality` (low/medium/high/auto) is the real
 * "fast vs premium" lever on ONE configured model, not two model names.
 *
 * OPENAI_IMAGE_MODEL selects the model (defaults to `gpt-image-1`, the
 * same default this app has used since interior/cover art generation was
 * first built — kept as the default here too rather than silently
 * switching to a newer model with different cost/latency, since this
 * sandbox can't reach OpenAI's pricing page to compare them). Set it to
 * `gpt-image-1.5` or `gpt-image-2` to opt into a newer model — both are
 * real, current models per the installed SDK.
 */
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
const TIMEOUT_MS = 55000;

function toFile(buf: Buffer, mimeType: string, name: string) {
  return new File([new Uint8Array(buf)], name, { type: mimeType });
}

export class OpenAIImageProvider implements ImageGenerationProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS });
  }

  async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const response = await this.client.images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt: req.prompt,
      size: (req.size ?? "1024x1024") as never,
      quality: req.quality as never,
      n: 1,
      output_format: (req.format ?? "png") as never,
      background: req.background as never,
    });
    return this.toResult(response);
  }

  async editImage(req: ImageEditRequest): Promise<ImageGenerationResult> {
    if (req.images.length === 0) throw new Error("editImage requires at least one input image.");
    const response = await this.client.images.edit({
      model: OPENAI_IMAGE_MODEL,
      image: req.images.map((img, i) => toFile(img.buffer, img.mimeType, `input-${i}.png`)),
      mask: req.mask ? toFile(req.mask.buffer, req.mask.mimeType, "mask.png") : undefined,
      prompt: req.prompt,
      size: (req.size ?? "1024x1024") as never,
      quality: req.quality as never,
      input_fidelity: req.inputFidelity as never,
      output_format: (req.format ?? "png") as never,
      background: req.background as never,
    });
    return this.toResult(response);
  }

  getCapabilities(): ImageProviderCapabilities {
    return {
      supportsEdit: true,
      supportsTransparency: true,
      // Only gpt-image-2/gpt-image-2-2026-04-21 support arbitrary WIDTHxHEIGHT sizes —
      // the configured model is a runtime env var, so this is a conservative default.
      supportsArbitrarySizes: OPENAI_IMAGE_MODEL.startsWith("gpt-image-2"),
      maxInputImages: 16,
    };
  }

  private toResult(response: any): ImageGenerationResult {
    const b64 = response?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI did not return image data.");
    const outputFormat = response?.output_format ?? "png";
    const mimeType = outputFormat === "jpeg" ? "image/jpeg" : outputFormat === "webp" ? "image/webp" : "image/png";
    return {
      buffer: Buffer.from(b64, "base64"),
      mimeType,
      provider: this.name,
      model: OPENAI_IMAGE_MODEL,
      usage: response?.usage
        ? { imageTokens: response.usage.input_tokens_details?.image_tokens, textTokens: response.usage.input_tokens_details?.text_tokens }
        : undefined,
    };
  }
}

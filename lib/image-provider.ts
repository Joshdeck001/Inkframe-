/**
 * The image-generation provider abstraction the Cover Designer depends
 * on — never a direct OpenAI/Gemini call scattered through cover code.
 * A future provider only ever needs to implement this interface.
 *
 * Model-name note (read before touching OPENAI_IMAGE_MODEL): there is no
 * "gpt-image-2.5-sunburst" or "gpt-image-2.5-flare" — those names don't
 * exist in OpenAI's real API. Verified directly against the installed
 * `openai` npm SDK's own type definitions (node_modules/openai/resources
 * /images.d.ts, package version 7.8.0 — this sandbox's network egress to
 * platform.openai.com is blocked, so the installed SDK's real, versioned
 * type definitions are the actual current source of truth used here, not
 * a live fetch). The real current model family is `gpt-image-1`,
 * `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`,
 * `gpt-image-2-2026-04-21`, and `chatgpt-image-latest` (`dall-e-2`/`3`
 * are the actually-obsolete ones this app never targets). None of them
 * has a "premium" vs "fast" sibling model — that distinction is real,
 * but it's the `quality` request parameter (`low`/`medium`/`high`/
 * `auto`) on ONE configured model, not two different model names. See
 * OPENAI_IMAGE_MODEL/OPENAI_IMAGE_MODEL_FAST in lib/openai-image-provider.ts.
 */

export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageBackground = "transparent" | "opaque" | "auto";
export type ImageFormat = "png" | "jpeg" | "webp";

export type ImageGenerationRequest = {
  prompt: string;
  size?: string; // "WIDTHxHEIGHT" or "auto"
  quality?: ImageQuality;
  format?: ImageFormat;
  background?: ImageBackground;
};

export type ImageEditRequest = ImageGenerationRequest & {
  images: { buffer: Buffer; mimeType: string }[];
  /** How hard the model tries to preserve faces/features from the input image(s). Not every provider supports this. */
  inputFidelity?: "low" | "high";
  /** Optional PNG mask — transparent areas mark what should change. */
  mask?: { buffer: Buffer; mimeType: string };
};

export type ImageUsage = { imageTokens?: number; textTokens?: number };

export type ImageGenerationResult = {
  buffer: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  usage?: ImageUsage;
};

export type ImageProviderCapabilities = {
  supportsEdit: boolean;
  supportsTransparency: boolean;
  supportsArbitrarySizes: boolean;
  maxInputImages: number;
};

export interface ImageGenerationProvider {
  readonly name: string;
  generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
  editImage(req: ImageEditRequest): Promise<ImageGenerationResult>;
  getCapabilities(): ImageProviderCapabilities;
}

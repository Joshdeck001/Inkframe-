import { GoogleGenAI, Modality } from "@google/genai";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageGenerationResult,
  ImageProviderCapabilities,
} from "@/lib/image-provider";

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.5-flash-image";
const TIMEOUT_MS = 55000;

/**
 * Fallback-only image provider — real generation, but editImage() throws
 * rather than silently generating from scratch and pretending that
 * satisfied an edit request. Claude has no image-generation capability
 * at all, so it's never part of any image provider chain (unlike the
 * text/structured chain in lib/ai-client.ts, which does include it).
 */
export class GeminiImageProvider implements ImageGenerationProvider {
  readonly name = "gemini";
  private client: GoogleGenAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenAI({ apiKey: apiKey ?? process.env.GEMINI_API_KEY });
  }

  async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    // generateImages() (the Imagen-family endpoint) only works on Vertex AI/Enterprise,
    // not a plain Gemini API key — generateContent() with forced IMAGE output is the
    // actually-working path, same finding as lib/image-client.ts.
    const response = await this.client.models.generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: req.prompt,
      config: { responseModalities: [Modality.IMAGE], httpOptions: { timeout: TIMEOUT_MS } },
    });
    const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("Gemini did not return image data.");
    return {
      buffer: Buffer.from(part.inlineData.data, "base64"),
      mimeType: part.inlineData.mimeType || "image/png",
      provider: this.name,
      model: GEMINI_IMAGE_MODEL,
    };
  }

  async editImage(_req: ImageEditRequest): Promise<ImageGenerationResult> {
    throw new Error("Gemini image editing/reference-image input is not implemented in this app — use the OpenAI provider for edits.");
  }

  getCapabilities(): ImageProviderCapabilities {
    return { supportsEdit: false, supportsTransparency: false, supportsArbitrarySizes: false, maxInputImages: 0 };
  }
}

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI, Type as GeminiType, FunctionCallingConfigMode } from "@google/genai";

/**
 * Three AI providers, tried in order, so one department's work never stops
 * cold because a single vendor is rate-limited, down, or out of budget:
 * Anthropic (Claude) first, then OpenAI, then Gemini. A provider is skipped
 * entirely if its API key isn't configured — this app runs fine with just
 * one key set, same as before. Every caller gets back which provider and
 * model actually served the request, so `model_used` columns record the
 * real answer instead of a hardcoded string.
 */

export type AiProvider = "anthropic" | "openai" | "gemini";

// A pragmatic subset of JSON Schema — exactly what this codebase's tool
// definitions actually use, kept provider-agnostic (Anthropic/OpenAI both
// accept this directly; toGeminiSchema() below converts it for Gemini).
export type JsonSchema = {
  type: string | (string | null)[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: readonly string[];
  required?: readonly string[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};

export type ToolSpec = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, JsonSchema>;
    required?: readonly string[];
  };
};

export type StructuredResult<T> = { output: T; provider: AiProvider; model: string };
export type TextResult = { text: string; provider: AiProvider; model: string };

const ANTHROPIC_MODEL = "claude-opus-5";
// Configurable without a code change (same philosophy as PLAN_TIER) — set
// OPENAI_MODEL / GEMINI_MODEL in Vercel's dashboard if either vendor
// renames or deprecates the default below.
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o";
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- Anthropic ---------------------------------------------------------

async function anthropicStructured(system: string, userContent: string, tool: ToolSpec, maxTokens: number) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userContent }],
    tools: [{ name: tool.name, description: tool.description, input_schema: tool.input_schema }],
    tool_choice: { type: "tool", name: tool.name },
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Anthropic did not return structured output.");
  return toolUse.input;
}

async function anthropicText(system: string, userContent: string, maxTokens: number) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userContent }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Anthropic did not return text output.");
  return textBlock.text.trim();
}

// --- OpenAI --------------------------------------------------------------

async function openaiStructured(system: string, userContent: string, tool: ToolSpec, maxTokens: number) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }],
    tool_choice: { type: "function", function: { name: tool.name } },
  });
  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") throw new Error("OpenAI did not return structured output.");
  return JSON.parse(call.function.arguments);
}

async function openaiText(system: string, userContent: string, maxTokens: number) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("OpenAI did not return text output.");
  return text.trim();
}

// --- Gemini ----------------------------------------------------------------

// Gemini's Schema uses UPPERCASE type names and stringified min/maxItems,
// unlike the standard-JSON-Schema dialect Anthropic/OpenAI both take
// directly — this is the one real format gap between the three providers.
function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nullable = types.includes(null as unknown as string) || types.includes("null");
  const realType = (types.find((t) => t && t !== "null") ?? "string") as string;
  const typeMap: Record<string, GeminiType> = {
    object: GeminiType.OBJECT,
    array: GeminiType.ARRAY,
    string: GeminiType.STRING,
    number: GeminiType.NUMBER,
    integer: GeminiType.INTEGER,
    boolean: GeminiType.BOOLEAN,
  };

  const out: Record<string, unknown> = { type: typeMap[realType] ?? GeminiType.STRING };
  if (nullable) out.nullable = true;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.required) out.required = schema.required;
  if (schema.minItems !== undefined) out.minItems = String(schema.minItems);
  if (schema.maxItems !== undefined) out.maxItems = String(schema.maxItems);
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  return out;
}

async function geminiStructured(system: string, userContent: string, tool: ToolSpec, maxTokens: number) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userContent,
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens,
      tools: [
        {
          functionDeclarations: [
            { name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.input_schema) },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [tool.name] },
      },
    },
  });
  const call = response.functionCalls?.[0];
  if (!call?.args) throw new Error("Gemini did not return structured output.");
  return call.args;
}

async function geminiText(system: string, userContent: string, maxTokens: number) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userContent,
    config: { systemInstruction: system, maxOutputTokens: maxTokens },
  });
  const text = response.text;
  if (!text) throw new Error("Gemini did not return text output.");
  return text.trim();
}

// --- Fallback chain --------------------------------------------------------

const PROVIDERS: { name: AiProvider; envKey: string; model: string }[] = [
  { name: "anthropic", envKey: "ANTHROPIC_API_KEY", model: ANTHROPIC_MODEL },
  { name: "openai", envKey: "OPENAI_API_KEY", model: OPENAI_MODEL },
  { name: "gemini", envKey: "GEMINI_API_KEY", model: GEMINI_MODEL },
];

export async function generateStructured<T>(opts: {
  system: string;
  userContent: string;
  tool: ToolSpec;
  maxTokens?: number;
}): Promise<StructuredResult<T>> {
  const maxTokens = opts.maxTokens ?? 2000;
  const errors: string[] = [];
  for (const p of PROVIDERS) {
    if (!process.env[p.envKey]) continue;
    try {
      const output =
        p.name === "anthropic"
          ? await anthropicStructured(opts.system, opts.userContent, opts.tool, maxTokens)
          : p.name === "openai"
            ? await openaiStructured(opts.system, opts.userContent, opts.tool, maxTokens)
            : await geminiStructured(opts.system, opts.userContent, opts.tool, maxTokens);
      return { output: output as T, provider: p.name, model: p.model };
    } catch (e) {
      errors.push(`${p.name}: ${errorMessage(e)}`);
    }
  }
  if (errors.length === 0) {
    throw new Error("No AI provider is configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY).");
  }
  throw new Error(`All configured AI providers failed — ${errors.join(" | ")}`);
}

export async function generateText(opts: { system: string; userContent: string; maxTokens?: number }): Promise<TextResult> {
  const maxTokens = opts.maxTokens ?? 8000;
  const errors: string[] = [];
  for (const p of PROVIDERS) {
    if (!process.env[p.envKey]) continue;
    try {
      const text =
        p.name === "anthropic"
          ? await anthropicText(opts.system, opts.userContent, maxTokens)
          : p.name === "openai"
            ? await openaiText(opts.system, opts.userContent, maxTokens)
            : await geminiText(opts.system, opts.userContent, maxTokens);
      return { text, provider: p.name, model: p.model };
    } catch (e) {
      errors.push(`${p.name}: ${errorMessage(e)}`);
    }
  }
  if (errors.length === 0) {
    throw new Error("No AI provider is configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY).");
  }
  throw new Error(`All configured AI providers failed — ${errors.join(" | ")}`);
}

/** "anthropic:claude-opus-5" — a real, honest record of which AI actually wrote something, for `model_used` columns. */
export function modelUsedLabel(result: { provider: AiProvider; model: string }): string {
  return `${result.provider}:${result.model}`;
}

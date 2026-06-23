// Unified LLM provider for ALL AI Edge Functions. One import → one place that
// decides the provider, key and model, so a single secret activates every AI
// feature (Copilot, email writer, PO/production-log extractors).
//
// Provider precedence: NVIDIA (Nemotron) if NVIDIA_API_KEY is set, else Gemini
// if GEMINI_API_KEY is set. The SAME NVIDIA key is used for every NIM model, so:
//   - text tasks  → NVIDIA_MODEL          (default: Nemotron; e.g. "Nemotron 3 Ultra")
//   - vision tasks → NVIDIA_VISION_MODEL  (a multimodal NIM model — Nemotron text
//     models can't read images/PDFs, so the two extractors auto-use this)
// Set per the function's needs; sensible defaults below.
import { generateJson as nvidiaJson } from "./nvidia.ts";
import { generateJson as geminiJson } from "./gemini.ts";

export const DEFAULT_NVIDIA_VISION_MODEL = "meta/llama-3.2-90b-vision-instruct";

export type LlmPart = { text?: string } | { inlineData?: { mimeType: string; data: string } };

export const AI_NOT_CONFIGURED =
  "AI is not configured yet — set the NVIDIA_API_KEY secret (Nemotron) on this Edge Function to activate it.";

/** Which provider is active, or null if no AI key is set. */
export function aiProvider(): "nvidia" | "gemini" | null {
  if (Deno.env.get("NVIDIA_API_KEY")) return "nvidia";
  if (Deno.env.get("GEMINI_API_KEY")) return "gemini";
  return null;
}
export function aiConfigured(): boolean {
  return aiProvider() !== null;
}

/**
 * Provider-agnostic structured JSON generation. Callers pass system/parts/schema
 * exactly as before — the key, provider and model are resolved here. Image/PDF
 * parts automatically route to the vision model under NVIDIA.
 */
export async function generateJson(opts: {
  system: string;
  parts: LlmPart[];
  schema: any;
  maxOutputTokens?: number;
}): Promise<{ result: any; usage: any; finishReason: string }> {
  const provider = aiProvider();
  const hasMedia = (opts.parts || []).some((p: any) => p?.inlineData);

  if (provider === "nvidia") {
    const apiKey = Deno.env.get("NVIDIA_API_KEY")!;
    const model = hasMedia ? (Deno.env.get("NVIDIA_VISION_MODEL") || DEFAULT_NVIDIA_VISION_MODEL) : undefined;
    return nvidiaJson({ apiKey, system: opts.system, parts: opts.parts as any, schema: opts.schema, maxOutputTokens: opts.maxOutputTokens, model });
  }
  if (provider === "gemini") {
    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    return geminiJson({ apiKey, system: opts.system, parts: opts.parts as any, schema: opts.schema, maxOutputTokens: opts.maxOutputTokens });
  }
  throw new Error(AI_NOT_CONFIGURED);
}

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
import { generateJson as nvidiaJson, generateText as nvidiaText } from "./nvidia.ts";
import { generateJson as geminiJson, generateText as geminiText } from "./gemini.ts";

export const DEFAULT_NVIDIA_VISION_MODEL = "meta/llama-3.2-90b-vision-instruct";

export type LlmPart = { text?: string } | { inlineData?: { mimeType: string; data: string } };

export const AI_NOT_CONFIGURED =
  "AI is not configured yet — set the NVIDIA_API_KEY secret (Nemotron) on this Edge Function to activate it.";

/**
 * Pick the provider for a task. TEXT prefers NVIDIA (Nemotron). VISION/DOCUMENT
 * tasks prefer GEMINI when available, because Gemini reads PDFs + large scans
 * natively with schema output — NVIDIA's vision models take only small images
 * and reject PDFs. Falls back to whichever key is set.
 */
export function aiProvider(hasMedia = false): "nvidia" | "gemini" | null {
  const nv = !!Deno.env.get("NVIDIA_API_KEY");
  const gem = !!Deno.env.get("GEMINI_API_KEY");
  if (hasMedia) {
    if (gem) return "gemini";
    if (nv) return "nvidia";
  } else {
    if (nv) return "nvidia";
    if (gem) return "gemini";
  }
  return null;
}
export function aiConfigured(): boolean {
  return !!(Deno.env.get("NVIDIA_API_KEY") || Deno.env.get("GEMINI_API_KEY"));
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
  const hasMedia = (opts.parts || []).some((p: any) => p?.inlineData);
  const hasPdf = (opts.parts || []).some((p: any) => String(p?.inlineData?.mimeType || "").includes("pdf"));
  const provider = aiProvider(hasMedia);

  if (provider === "nvidia") {
    // NVIDIA vision can't read PDFs — fail with a clear, actionable message
    // instead of an opaque upstream 500.
    if (hasPdf) {
      throw new Error("This document is a PDF. The NVIDIA vision model reads images only — upload a photo/scan (JPG/PNG) of the document, or add a GEMINI_API_KEY secret to enable PDF + scan extraction.");
    }
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

/**
 * Provider-agnostic PLAIN-TEXT generation. Use for long-form output where strict
 * JSON is fragile (the model leaves unescaped quotes/newlines in long bodies).
 * Caller parses a delimited format in code. Text tasks → NVIDIA, else Gemini.
 */
export async function generateText(opts: {
  system: string;
  parts: LlmPart[];
  maxOutputTokens?: number;
}): Promise<{ text: string; usage: any; finishReason: string }> {
  const provider = aiProvider(false);
  if (provider === "nvidia") {
    return nvidiaText({ apiKey: Deno.env.get("NVIDIA_API_KEY")!, system: opts.system, parts: opts.parts as any, maxOutputTokens: opts.maxOutputTokens });
  }
  if (provider === "gemini") {
    return geminiText({ apiKey: Deno.env.get("GEMINI_API_KEY")!, system: opts.system, parts: opts.parts as any, maxOutputTokens: opts.maxOutputTokens });
  }
  throw new Error(AI_NOT_CONFIGURED);
}

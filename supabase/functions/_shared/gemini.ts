// Shared Google Gemini helpers for the ERP Edge Functions.
//
// Uses the REST generateContent endpoint directly (no SDK) so there is no
// npm/version risk inside the Deno runtime. Supports vision (images), PDFs and
// structured JSON output via responseSchema. The API key stays server-side as
// the GEMINI_API_KEY Edge Function secret — the browser never sees it.

export const GEMINI_MODEL = "gemini-2.5-flash";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Convert an Anthropic/JSON-Schema object into a Gemini responseSchema:
//  - types become UPPERCASE (STRING, NUMBER, INTEGER, ARRAY, OBJECT, ...)
//  - `additionalProperties` is dropped (Gemini rejects it)
//  - `propertyOrdering` is added so fields come back in a stable order
export function toGeminiSchema(s: any): any {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (s && typeof s === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === "additionalProperties") continue;
      if (k === "type" && typeof v === "string") { out.type = v.toUpperCase(); continue; }
      if (k === "properties" && v && typeof v === "object") {
        out.properties = {};
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          out.properties[pk] = toGeminiSchema(pv);
        }
        out.propertyOrdering = Object.keys(v as Record<string, unknown>);
        continue;
      }
      if (k === "items") { out.items = toGeminiSchema(v); continue; }
      out[k] = v;
    }
    return out;
  }
  return s;
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

// Call Gemini and return parsed structured JSON. Throws with a useful message
// on HTTP errors, safety blocks, empty output, or truncated/unparseable JSON.
export async function generateJson(opts: {
  apiKey: string;
  system: string;
  parts: GeminiPart[];
  schema: any;
  maxOutputTokens?: number;
}): Promise<{ result: any; usage: any; finishReason: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const payload = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: opts.parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(opts.schema),
      // Generous ceiling: Gemini 2.5 spends part of this budget on internal
      // "thinking", so leave plenty of headroom to avoid truncated JSON.
      maxOutputTokens: opts.maxOutputTokens ?? 32000,
      temperature: 0,
    },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
    body: JSON.stringify(payload),
  });
  const data = await r.json();

  if (!r.ok) throw new Error(data?.error?.message || `Gemini HTTP ${r.status}`);
  if (data?.promptFeedback?.blockReason) {
    throw new Error(`Declined by Gemini safety filters (${data.promptFeedback.blockReason}).`);
  }

  const cand = data?.candidates?.[0];
  const finishReason = cand?.finishReason || "STOP";
  const text = (cand?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join("");
  if (!text) throw new Error(`Gemini returned no content (finishReason: ${finishReason}).`);

  let result: any = null;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Could not parse Gemini JSON (finishReason: ${finishReason}; likely truncated).`);
  }
  return { result, usage: data?.usageMetadata ?? null, finishReason };
}

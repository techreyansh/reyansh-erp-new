// Shared NVIDIA (NIM) helper for the ERP Edge Functions — Nemotron models.
//
// NVIDIA's hosted API (build.nvidia.com / integrate.api.nvidia.com) is
// OpenAI-compatible, so we call /chat/completions directly (no SDK → no Deno
// version risk). Mirrors the gemini.ts generateJson() contract so an Edge
// Function can swap providers with one import change.
//
// Secrets (set on the Edge Function):
//   NVIDIA_API_KEY   — required. The "nvapi-..." key from build.nvidia.com.
//   NVIDIA_MODEL     — optional. Exact model id, e.g. the "Nemotron 3 Ultra"
//                      id shown on the model's API page. Defaults below.
//   NVIDIA_BASE_URL  — optional. Defaults to the hosted NIM endpoint.

// Default = Nemotron 3 Ultra (the model the user provisioned). Override with the
// NVIDIA_MODEL secret if the id changes.
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
export const NVIDIA_MODEL = Deno.env.get("NVIDIA_MODEL") || DEFAULT_NVIDIA_MODEL;
export const NVIDIA_BASE_URL = (Deno.env.get("NVIDIA_BASE_URL") || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");

// Nemotron 3 is a reasoning model: thinking is toggled via chat_template_kwargs.
// For our structured-JSON tasks we DISABLE thinking by default → clean JSON,
// lower latency, and no risk of blowing the Edge Function time/token budget.
// Set NVIDIA_ENABLE_THINKING=true to turn deep reasoning on (slower, richer).
export const NVIDIA_THINKING = (Deno.env.get("NVIDIA_ENABLE_THINKING") || "false").toLowerCase() === "true";
export const NVIDIA_REASONING_BUDGET = Number(Deno.env.get("NVIDIA_REASONING_BUDGET") || "8192");

// Text part, or an inline image/PDF (same shape as GeminiPart.inlineData) so
// vision Edge Functions can pass media through unchanged.
export type NvidiaPart = { text?: string } | { inlineData?: { mimeType: string; data: string } };

// Build a compact JSON skeleton from a JSON-Schema so the model knows the
// EXACT shape to return (NVIDIA's json_object mode doesn't enforce a schema).
function skeleton(s: any): any {
  if (!s || typeof s !== "object") return "string";
  if (s.properties || s.type === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties || {})) o[k] = skeleton(v);
    return o;
  }
  if (s.type === "array") return [skeleton(s.items || { type: "string" })];
  if (s.type === "number" || s.type === "integer") return 0;
  if (s.type === "boolean") return false;
  return s.type || "string";
}

// Repair the #1 LLM JSON defect: raw control chars (newlines/tabs) left
// unescaped INSIDE string values — common when a model writes long multi-line
// bodies. Walks string-aware and escapes them so JSON.parse succeeds.
function repairJson(s: string): string {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === "\\") { out += c; esc = true; continue; }
      if (c === '"') { out += c; inStr = false; continue; }
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      out += c;
    } else {
      if (c === '"') inStr = true;
      out += c;
    }
  }
  return out;
}

function tryParse(s: string): any {
  try { return JSON.parse(s); } catch { /* try repair */ }
  try { return JSON.parse(repairJson(s)); } catch { return undefined; }
}

// Pull a JSON object out of model output: drop <think>…</think> reasoning
// (Nemotron reasoning models may emit it even with thinking off), strip ```
// fences, then parse — STRING-AWARE balanced {…} scan + control-char repair.
function extractJson(text: string): any {
  let t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  let r = tryParse(t);
  if (r !== undefined) return r;
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { r = tryParse(t.slice(start, i + 1)); return r === undefined ? null : r; }
    }
  }
  return null;
}

async function post(url: string, apiKey: string, payload: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

// Call NVIDIA/Nemotron and return parsed structured JSON. Same contract as the
// Gemini helper: { result, usage, finishReason }. `schema` guides the prompt.
export async function generateJson(opts: {
  apiKey: string;
  system: string;
  parts: NvidiaPart[];
  schema: any;
  maxOutputTokens?: number;
  model?: string;
}): Promise<{ result: any; usage: any; finishReason: string }> {
  const model = opts.model || NVIDIA_MODEL;
  // Build OpenAI-style user content. With images/PDFs, use the array form with
  // image_url data URIs (needs a vision-capable model); otherwise plain text.
  const parts: any[] = opts.parts || [];
  const hasMedia = parts.some((p) => p?.inlineData);
  const userContent: any = hasMedia
    ? parts.map((p) => (p?.inlineData
      ? { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
      : { type: "text", text: p?.text || "" })).filter((c) => c.type !== "text" || c.text)
    : parts.map((p) => p?.text).filter(Boolean).join("\n\n");
  const system = `${opts.system}\n\n` +
    `OUTPUT FORMAT: respond with a SINGLE valid JSON object ONLY — no markdown, no commentary, no <think> tags. ` +
    `It must match this exact shape (same keys):\n${JSON.stringify(skeleton(opts.schema))}\n` +
    `Every string value MUST be valid JSON: escape line breaks as \\n and double-quotes as \\", and never put a raw line break inside a string. Keep each body concise.`;

  // Sampling follows Nemotron guidance: greedy-ish for JSON when thinking is off,
  // the model's recommended temp/top_p when reasoning is on.
  const base: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
    temperature: NVIDIA_THINKING ? 1 : 0.2,
    top_p: NVIDIA_THINKING ? 0.95 : 0.9,
    max_tokens: opts.maxOutputTokens ?? 8000,
    stream: false,
    chat_template_kwargs: { enable_thinking: NVIDIA_THINKING },
    ...(NVIDIA_THINKING ? { reasoning_budget: NVIDIA_REASONING_BUDGET } : {}),
  };
  const url = `${NVIDIA_BASE_URL}/chat/completions`;

  // Prefer JSON mode; some Nemotron variants reject response_format → retry plain.
  let { r, data } = await post(url, opts.apiKey, { ...base, response_format: { type: "json_object" } });
  if (!r.ok && (r.status === 400 || r.status === 422)) {
    ({ r, data } = await post(url, opts.apiKey, base));
  }
  if (!r.ok) throw new Error(data?.error?.message || data?.detail || data?.message || `NVIDIA HTTP ${r.status}`);

  const choice = data?.choices?.[0];
  const finishReason = choice?.finish_reason || "stop";
  const content = choice?.message?.content ?? "";
  if (!content) throw new Error(`NVIDIA returned no content (finish_reason: ${finishReason}).`);

  const result = extractJson(content);
  if (result == null) throw new Error(`Could not parse NVIDIA JSON (finish_reason: ${finishReason}; likely truncated).`);
  return { result, usage: data?.usage ?? null, finishReason };
}

// Plain-TEXT generation (no JSON). For long-form output where strict JSON is
// fragile — callers parse a delimited format in code instead.
export async function generateText(opts: {
  apiKey: string;
  system: string;
  parts: NvidiaPart[];
  maxOutputTokens?: number;
  model?: string;
}): Promise<{ text: string; usage: any; finishReason: string }> {
  const model = opts.model || NVIDIA_MODEL;
  const parts: any[] = opts.parts || [];
  const hasMedia = parts.some((p) => p?.inlineData);
  const userContent: any = hasMedia
    ? parts.map((p) => (p?.inlineData
      ? { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
      : { type: "text", text: p?.text || "" })).filter((c) => c.type !== "text" || c.text)
    : parts.map((p) => p?.text).filter(Boolean).join("\n\n");

  const { r, data } = await post(`${NVIDIA_BASE_URL}/chat/completions`, opts.apiKey, {
    model,
    messages: [{ role: "system", content: opts.system }, { role: "user", content: userContent }],
    temperature: NVIDIA_THINKING ? 1 : 0.3,
    top_p: NVIDIA_THINKING ? 0.95 : 0.9,
    max_tokens: opts.maxOutputTokens ?? 8000,
    stream: false,
    chat_template_kwargs: { enable_thinking: NVIDIA_THINKING },
    ...(NVIDIA_THINKING ? { reasoning_budget: NVIDIA_REASONING_BUDGET } : {}),
  });
  if (!r.ok) throw new Error(data?.error?.message || data?.detail || data?.message || `NVIDIA HTTP ${r.status}`);
  const choice = data?.choices?.[0];
  const finishReason = choice?.finish_reason || "stop";
  const content = String(choice?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!content) throw new Error(`NVIDIA returned no content (finish_reason: ${finishReason}).`);
  return { text: content, usage: data?.usage ?? null, finishReason };
}

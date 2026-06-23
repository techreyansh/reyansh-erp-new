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

// Default model id — OVERRIDE with the NVIDIA_MODEL secret to the exact
// "Nemotron 3 Ultra" id from the model's page (model strings change between
// releases; the page's API tab shows the precise value to use here).
export const DEFAULT_NVIDIA_MODEL = "nvidia/llama-3.1-nemotron-ultra-253b-v1";
export const NVIDIA_MODEL = Deno.env.get("NVIDIA_MODEL") || DEFAULT_NVIDIA_MODEL;
export const NVIDIA_BASE_URL = (Deno.env.get("NVIDIA_BASE_URL") || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");

export type NvidiaPart = { text?: string };

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

// Pull a JSON object out of model output: drop <think>…</think> reasoning,
// strip ``` fences, then parse — falling back to first balanced {…} block.
function extractJson(text: string): any {
  let t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const i = t.indexOf("{");
  if (i >= 0) {
    let depth = 0;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(t.slice(i, j + 1)); } catch { break; } } }
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
  const userText = (opts.parts || []).map((p) => p.text).filter(Boolean).join("\n\n");
  // "detailed thinking off" disables Nemotron's reasoning trace so we get clean
  // JSON; the shape hint keeps the model on the exact contract.
  const system = `detailed thinking off\n\n${opts.system}\n\n` +
    `OUTPUT FORMAT: respond with a SINGLE valid JSON object ONLY — no markdown, no commentary, no <think> tags. ` +
    `It must match this exact shape (same keys):\n${JSON.stringify(skeleton(opts.schema))}`;

  const base = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: userText }],
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: opts.maxOutputTokens ?? 8000,
    stream: false,
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

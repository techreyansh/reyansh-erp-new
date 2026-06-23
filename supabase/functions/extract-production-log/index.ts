// Supabase Edge Function: extract-production-log
//
// Reads uploaded production sheets — Excel/CSV (parsed to rows client-side) AND
// photos of handwritten/printed sheets (vision) — and uses Google Gemini to:
//   mode "extract": unpivot any format into normalized line × time-slot rows
//   mode "analyze": produce root-cause / comparison / downtime / summary insights
//
// The Gemini API key stays server-side (Edge Function secret), never in the browser.
//
// Deploy:
//   supabase functions deploy extract-production-log
//   supabase secrets set GEMINI_API_KEY=AIza...
//
// Model: gemini-2.5-flash (vision + structured outputs) — see ../_shared/gemini.ts.
import { CORS, json, GEMINI_MODEL, type GeminiPart } from "../_shared/gemini.ts";
import { aiConfigured, generateJson, AI_NOT_CONFIGURED } from "../_shared/llm.ts";

// ---- Structured output schemas -------------------------------------------------
const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          log_date: { type: "string", description: "ISO date YYYY-MM-DD; infer from the sheet" },
          department: { type: "string", description: "assembly | cable | molding | other" },
          line_no: { type: "string", description: "e.g. 'Line 1'" },
          line_leader: { type: "string" },
          model: { type: "string", description: "product/model code, e.g. C10041" },
          manpower: { type: "integer" },
          time_slot: { type: "string", description: "e.g. '09-10' or '11:15-12:15'" },
          slot_index: { type: "integer", description: "0-based order of the slot within the day" },
          target: { type: "number" },
          achieved: { type: "number" },
          downtime_minutes: { type: "number" },
          reason: { type: "string", description: "downtime/shortfall reason, e.g. 'MATERIAL FINISH'; empty if none" },
        },
        required: ["log_date", "department", "line_no", "line_leader", "model", "manpower",
          "time_slot", "slot_index", "target", "achieved", "downtime_minutes", "reason"],
      },
    },
    departments: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["entries", "departments", "warnings"],
};

const ANALYZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "Plain-language end-of-day summary a manager reads in 10 seconds" },
    root_causes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          line_no: { type: "string" },
          time_slot: { type: "string" },
          lost_units: { type: "number" },
        },
        required: ["title", "detail", "line_no", "time_slot", "lost_units"],
      },
    },
    comparisons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { label: { type: "string" }, detail: { type: "string" } },
        required: ["label", "detail"],
      },
    },
    downtime: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { reason: { type: "string" }, total_minutes: { type: "number" }, occurrences: { type: "integer" } },
        required: ["reason", "total_minutes", "occurrences"],
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "root_causes", "comparisons", "downtime", "recommendations"],
};

const EXTRACT_SYSTEM = `You are a manufacturing data extraction engine for a cable/power-cord/molding plant.
You receive hourly/daily production sheets in ANY format — Excel/CSV tables, or PHOTOS of handwritten/printed sheets.
These are typically WIDE MATRICES: metrics (Target, Achieved, Downtime, Reason) run down the rows, time-slots run across the columns, and each production line is a stacked block with its own Line No, Line Leader, Model, Date and Manpower.

UNPIVOT every sheet into a flat list: ONE ENTRY PER (line × time-slot). For each entry capture target, achieved, downtime and reason for that specific hour.
- Compute slot_index as the left-to-right order of the time-slot (0-based).
- Do NOT invent data. If a cell is blank, use 0 (numbers) or "" (text).
- Do NOT include TOTAL columns or plant-rollup rows as entries — those are derived.
- Infer department from the sheet title (e.g. "HOURLY DATA (ASSEMBLY)" → assembly).
- Put any ambiguity or low-confidence reads in "warnings".`;

const ANALYZE_SYSTEM = `You are a plant-floor analyst. Given normalized hourly production rows, produce actionable insights:
- root_causes: where and when output was lost and why (downtime reasons, material stockouts like "MATERIAL FINISH", manpower). Quantify lost_units = max(target-achieved, 0) for the relevant line/slot.
- comparisons: rank lines and time-slots; call out best and worst performers and trends across the day.
- downtime: aggregate downtime reasons across the data — recurring causes, biggest cumulative losers.
- summary: a crisp end-of-day summary a manager reads in 10 seconds (total achieved vs target, key issues, what to act on).
Be specific and numeric. Do not pad.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!aiConfigured()) return json({ error: AI_NOT_CONFIGURED }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const mode = body?.mode === "analyze" ? "analyze" : "extract";

  try {
    const parts: GeminiPart[] = [];

    if (mode === "extract") {
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) return json({ error: "No files provided." }, 400);

      parts.push({
        text: `Extract normalized production rows from the ${files.length} file(s) below.` +
          (body.department ? ` Hint: department is "${body.department}".` : ""),
      });
      for (const f of files) {
        if (f.kind === "image" && f.dataBase64) {
          parts.push({ text: `--- Photo: ${f.name || "sheet"} ---` });
          parts.push({ inlineData: { mimeType: f.mediaType || "image/jpeg", data: f.dataBase64 } });
        } else if (f.kind === "sheet" && Array.isArray(f.rows)) {
          parts.push({
            text: `--- Spreadsheet: ${f.name || "sheet"} (JSON rows) ---\n${JSON.stringify(f.rows).slice(0, 200000)}`,
          });
        }
      }
    } else {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return json({ error: "No normalized rows provided to analyze." }, 400);
      parts.push({
        text: `Analyze these normalized hourly production rows:\n${JSON.stringify(rows).slice(0, 200000)}`,
      });
    }

    const { result, usage } = await generateJson({
      system: mode === "extract" ? EXTRACT_SYSTEM : ANALYZE_SYSTEM,
      parts,
      schema: mode === "extract" ? EXTRACT_SCHEMA : ANALYZE_SCHEMA,
    });
    return json({ mode, model: GEMINI_MODEL, result, usage });
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

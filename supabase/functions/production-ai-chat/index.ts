// Production AI chat — ask questions over the captured hourly-production data.
// Receives { tool, context, input } and returns structured { sections } from an
// LLM using a production-operations system prompt. context = the Production
// Intelligence dashboard (KPIs, achievement trend, downtime-by-reason, per-line
// ranking, anomalies). tool is one of the presets below, or "ask" for free-form.
//
// Reuses the shared LLM layer (NVIDIA Nemotron preferred, Gemini fallback) — the
// same secret already powering ai-sales-copilot, so no new key is needed:
//   supabase functions deploy production-ai-chat
import { preflight, json } from "../_shared/cors.ts";
import { aiConfigured, aiProvider, generateText, AI_NOT_CONFIGURED } from "../_shared/llm.ts";

const SYSTEM = `You are a senior MANUFACTURING OPERATIONS / production-intelligence analyst for REYANSH INTERNATIONAL, an Indian manufacturer of power cords, wiring harnesses, cable assemblies and PVC cables. You analyse daily hourly-production logs: target vs achieved output, achievement %, downtime minutes by reason, per-line and per-time-slot performance, and flagged anomalies. You understand line balancing, OEE-style thinking, changeovers, material-shortage stoppages, manpower, and shop-floor realities.
Use ONLY the PRODUCTION CONTEXT provided. Be specific and quantitative — cite the actual numbers, lines, dates and downtime reasons from the context. Never invent data; if the context lacks something needed, say exactly what to capture. Write for a plant head / production manager: practical and floor-actionable.

OUTPUT FORMAT — output ONLY the sections, nothing else. Start each section with a line that is exactly "## " followed by the heading, then the body on the following lines (short paragraphs or "- " bullet points). Separate sections with a blank line. Do not use JSON, code fences, tables, or any preamble/closing text.`;

const TOOL_PROMPTS: Record<string, string> = {
  daily_summary: `PRODUCTION SUMMARY for the period in context. Sections: "Headline" (achieved vs target + achievement %), "Biggest Losses" (top downtime reasons with minutes), "Best & Worst Lines", "What To Fix First".`,
  line_performance: `LINE PERFORMANCE ANALYSIS. Sections: "Underperforming Lines" (which lines are below target and by how much), "Likely Causes" (tie to their downtime reasons), "Strong Lines", "Recommended Action Per Line".`,
  anomalies: `ANOMALY EXPLANATION. For the flagged anomalies in context, sections: "What Happened", "Likely Root Causes", "What To Check On The Floor", "Prevention".`,
  material_impact: `MATERIAL-IMPACT ANALYSIS. Sections: "Material-Related Downtime" (reasons like material finish / shortage / changeover, with minutes and an estimate of lost output), "Lines & Days Affected", "Stocking / Kitting Recommendations".`,
  machine_utilization: `UTILISATION & BOTTLENECKS. Sections: "Capacity vs Output", "Bottleneck Lines/Stations", "Where Downtime Concentrates", "Recommendations To Lift Throughput".`,
  shift_comparison: `TIME-SLOT / SHIFT COMPARISON. Sections: "Output By Time-Slot", "When Output Drops", "Likely Drivers", "Recommendations".`,
  ask: `Answer the user's QUESTION about production using ONLY the context. Be specific and quantitative (cite lines, dates, reasons, numbers). Structure the answer into 1–4 clearly-headed sections. If the data cannot answer it, say exactly what's missing.`,
};

// Parse the "## heading\nbody" format into sections (robust to long free text).
function parseSections(text: string): Array<{ heading: string; body: string }> {
  const out: Array<{ heading: string; body: string }> = [];
  let cur: { heading: string; body: string } | null = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const h = line.match(/^\s{0,3}#{1,4}\s+(.+)$/) || line.match(/^\s*\*\*(.+?)\*\*\s*:?\s*$/);
    if (h && h[1].trim().length <= 80) {
      if (cur) out.push(cur);
      cur = { heading: h[1].replace(/[:#*]+\s*$/, "").trim(), body: "" };
    } else if (cur) {
      cur.body += (cur.body ? "\n" : "") + raw;
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ heading: s.heading, body: s.body.trim() })).filter((s) => s.heading && s.body);
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    if (!aiConfigured()) return json({ error: AI_NOT_CONFIGURED }, 503);

    const { tool, context, input } = await req.json();
    const instruction = TOOL_PROMPTS[tool] || TOOL_PROMPTS.ask;

    const parts = [{
      text: `TASK: ${instruction}\n\nUSER QUESTION (if any):\n${input || "(none)"}\n\nPRODUCTION CONTEXT (JSON):\n${JSON.stringify(context || {}, null, 0).slice(0, 12000)}`,
    }];
    const { text, usage } = await generateText({ system: SYSTEM, parts, maxOutputTokens: 8000 });
    const sections = parseSections(text);
    return json({ sections: sections.length ? sections : [{ heading: "Answer", body: text }], usage, provider: aiProvider() });
  } catch (e) {
    return json({ error: (e as Error).message || "AI generation failed" }, 500);
  }
});

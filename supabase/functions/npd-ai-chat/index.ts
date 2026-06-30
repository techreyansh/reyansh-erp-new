// NPD AI chat — ask questions over the New Product Development analytics.
// Receives { tool, context, input } and returns structured { sections } from an
// LLM using an NPD program-analyst system prompt. context = the NPD Intelligence
// dashboard (KPIs, funnel by stage, stage aging, feedback-outcome mix, approvals
// trend, engineer load, development-type mix, rework, delayed projects). tool is
// one of the presets below, or "ask" for free-form.
//
// Reuses the shared LLM layer (NVIDIA Nemotron preferred, Gemini fallback) — the
// same secret already powering production-ai-chat / ai-sales-copilot, so no new
// key is needed:
//   supabase functions deploy npd-ai-chat
import { preflight, json } from "../_shared/cors.ts";
import { aiConfigured, aiProvider, generateText, AI_NOT_CONFIGURED } from "../_shared/llm.ts";

const SYSTEM = `You are a senior NEW PRODUCT DEVELOPMENT (NPD) program analyst for REYANSH INTERNATIONAL, an Indian manufacturer of power cords, wiring harnesses, cable assemblies and PVC cables. You analyse the customer-driven development pipeline: projects move through 11 stages (requirement_received → technical_review → bom_ready → costing_ready → material_ready → sample_development → testing → sample_dispatch → customer_feedback → approved → production_release). You track stage aging (time-in-stage), turnaround (created → approved), customer-feedback outcomes (approved / approved_with_changes / rejected / resample), the rework/resample loop, sample pass rates, development-type mix, engineer workload, and overdue developments and feedback. You understand sampling, costing, BOM readiness, customer approvals and the cost of rework loops.
Use ONLY the NPD CONTEXT provided. Be specific and quantitative — cite the actual numbers, stages, customers, engineers and dates from the context. Never invent data; if the context lacks something needed, say exactly what to capture. Write for an NPD head / engineering manager: practical and actionable.

OUTPUT FORMAT — output ONLY the sections, nothing else. Start each section with a line that is exactly "## " followed by the heading, then the body on the following lines (short paragraphs or "- " bullet points). Separate sections with a blank line. Do not use JSON, code fences, tables, or any preamble/closing text.`;

const TOOL_PROMPTS: Record<string, string> = {
  pipeline_summary: `NPD PIPELINE SUMMARY for the period in context. Sections: "Headline" (active developments, approved in range, approval rate), "Pipeline Shape" (where active projects sit by stage), "Throughput & Turnaround" (approvals trend + avg turnaround days), "What To Push First".`,
  bottlenecks: `BOTTLENECK ANALYSIS using the stage-aging and funnel data. Sections: "Slowest Stages" (highest avg days-in-stage, with the numbers), "Where Projects Pile Up" (stages holding the most active projects), "Likely Causes", "Recommended Actions Per Stage".`,
  overdue_risk: `RISK & OVERDUE ANALYSIS. Sections: "Delayed Developments" (past target date — name them with days overdue, customer, stage), "Overdue Customer Feedback" (dispatched samples awaiting feedback), "Risk Themes", "Recovery Actions".`,
  rework_patterns: `REWORK & RESAMPLE ANALYSIS. Sections: "Feedback Outcomes" (mix incl. resample / rejected counts), "Rework Load" (reworked projects, avg revisions), "Likely Drivers Of Rework" (tie to sample pass rate / stages), "How To Cut Rework Loops".`,
  engineer_load: `ENGINEER WORKLOAD ANALYSIS. Sections: "Load By Engineer" (active projects each), "Imbalance & Overload", "At-Risk Ownership" (engineers holding delayed projects), "Rebalancing Recommendations".`,
  ask: `Answer the user's QUESTION about NPD using ONLY the context. Be specific and quantitative (cite stages, customers, engineers, numbers). Structure the answer into 1–4 clearly-headed sections. If the data cannot answer it, say exactly what's missing.`,
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
      text: `TASK: ${instruction}\n\nUSER QUESTION (if any):\n${input || "(none)"}\n\nNPD CONTEXT (JSON):\n${JSON.stringify(context || {}, null, 0).slice(0, 12000)}`,
    }];
    const { text, usage } = await generateText({ system: SYSTEM, parts, maxOutputTokens: 8000 });
    const sections = parseSections(text);
    return json({ sections: sections.length ? sections : [{ heading: "Answer", body: text }], usage, provider: aiProvider() });
  } catch (e) {
    return json({ error: (e as Error).message || "AI generation failed" }, 500);
  }
});

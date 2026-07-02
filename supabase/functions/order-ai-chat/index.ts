// Order-workflow AI chat — ask questions over the O2D workflow engine state.
// Receives { tool, context, input } and returns structured { sections } from an
// LLM using an order-fulfillment-analyst system prompt. context is either the
// cross-order wf_dashboard blob (KPIs, by_stage bottlenecks, by_department,
// aging/stuck orders) or a single-order getWorkflow() payload (instance, stages,
// events, deps). tool is one of the presets below, or "ask" for free-form.
//
// Reuses the shared LLM layer (NVIDIA Nemotron preferred, Gemini fallback) — the
// same secret already powering production-ai-chat / ai-sales-copilot, no new key:
//   supabase functions deploy order-ai-chat
import { preflight, json } from "../_shared/cors.ts";
import { aiConfigured, aiProvider, generateText, AI_NOT_CONFIGURED } from "../_shared/llm.ts";

const SYSTEM = `You are a senior ORDER-FULFILLMENT / operations analyst for REYANSH INTERNATIONAL, an Indian manufacturer of power cords, wiring harnesses, cable assemblies and PVC cables. You analyse the Order-to-Dispatch workflow engine: each sales order becomes a workflow instance that moves through stages (Sales Order → Dispatch Planning → Production Planning → Store Issue → Cable → Assembly → Molding → Packing → Finished Goods → Dispatch → Closure), each stage gated by dependencies, owned by a department, with a due date and a status. You think in terms of bottlenecks, ageing, stage SLAs, blocked dependencies, and which department is holding things up.
Use ONLY the WORKFLOW CONTEXT provided. Be specific and quantitative — cite the actual order numbers, stage labels, departments, ages-in-days and due dates from the context. Never invent data; if the context lacks something needed, say exactly what to look at. Write for a CEO / operations head: practical and directly actionable.

OUTPUT FORMAT — output ONLY the sections, nothing else. Start each section with a line that is exactly "## " followed by the heading, then the body on the following lines (short paragraphs or "- " bullet points). Separate sections with a blank line. Do not use JSON, code fences, tables, or any preamble/closing text.`;

const TOOL_PROMPTS: Record<string, string> = {
  late_orders: `LATE / AT-RISK ORDERS. From the context, sections: "Most Overdue" (orders past due or longest-aged, with order number, current stage, age in days), "Why They're Stuck" (the blocking stage/department for each), "What To Chase First" (ranked, with the specific department/owner to push).`,
  bottleneck: `BOTTLENECK ANALYSIS across all active orders. Sections: "Where Orders Pile Up" (which stage holds the most active orders, and which has the most overdue), "Department Load" (which department has the most open / overdue stage work), "Root Cause" (likely reasons given the stage), "Recommended Actions".`,
  predicted_dispatch: `DISPATCH OUTLOOK. For the order(s) in context, sections: "Where It Is Now" (current stage + how long it's sat there), "Remaining Stages" (what's left before dispatch), "Risk To Dispatch Date" (is it tracking to its due/expected date, and what could slip it), "What Would Speed It Up".`,
  ask: `Answer the user's QUESTION about the order workflow(s) using ONLY the context. Be specific and quantitative (cite order numbers, stages, departments, days, due dates). Structure the answer into 1-4 clearly-headed sections. If the data cannot answer it, say exactly what's missing.`,
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
      text: `TASK: ${instruction}\n\nUSER QUESTION (if any):\n${input || "(none)"}\n\nWORKFLOW CONTEXT (JSON):\n${JSON.stringify(context || {}, null, 0).slice(0, 12000)}`,
    }];
    const { text, usage } = await generateText({ system: SYSTEM, parts, maxOutputTokens: 8000 });
    const sections = parseSections(text);
    return json({ sections: sections.length ? sections : [{ heading: "Answer", body: text }], usage, provider: aiProvider() });
  } catch (e) {
    return json({ error: (e as Error).message || "AI generation failed" }, 500);
  }
});

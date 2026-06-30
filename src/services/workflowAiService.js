// Order-workflow AI — thin layer over the order-ai-chat edge function.
// Context is gathered client-side and passed in: the wf_dashboard blob for
// cross-order questions, or a getWorkflow(soId) payload for a single order.
// Mirrors npdMetricsService.askNpd — never throws.
import { supabase } from "../lib/supabaseClient";

/** Preset tools for the cross-order (Control Tower) assistant. */
export const WORKFLOW_AI_PRESETS = [
  { tool: "late_orders", label: "Late / at-risk orders" },
  { tool: "bottleneck", label: "Where's the bottleneck?" },
];

/** Preset tools for the per-order (timeline) assistant. */
export const ORDER_AI_PRESETS = [
  { tool: "predicted_dispatch", label: "Dispatch outlook" },
  { tool: "bottleneck", label: "Why is this stuck?" },
];

/**
 * Ask the order-workflow AI over already-loaded context. Never throws —
 * resolves to { sections } or { error } (friendly message drained from the
 * edge error body). Returns AI_NOT_CONFIGURED text if the fn isn't deployed.
 */
export async function askWorkflow(tool, input, context) {
  try {
    const { data, error } = await supabase.functions.invoke("order-ai-chat", {
      body: { tool: tool || "ask", input: input || "", context: context || {} },
    });
    if (error) {
      let msg = error.message || "AI request failed";
      try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* ignore */ }
      return { error: msg };
    }
    if (data?.error) return { error: data.error };
    return { sections: data?.sections || [] };
  } catch (e) {
    return { error: e?.message || "AI request failed" };
  }
}

const workflowAiService = { askWorkflow, WORKFLOW_AI_PRESETS, ORDER_AI_PRESETS };
export default workflowAiService;

// NPD Intelligence — analytics over the New Product Development module.
// Thin layer over the npd_intel_summary RPC + filter options. Mirrors
// productionMetricsService.
import { supabase } from "../lib/supabaseClient";
import npdService from "./npdService";

// Mirror of DEV_TYPES in src/components/crm/NPDDevelopmentPanel.js (inlined to
// keep this service free of a component dependency).
export const DEV_TYPES = [
  { v: "drawing_based", l: "Drawing based" },
  { v: "sample_based", l: "Sample based" },
  { v: "modification", l: "Modification" },
  { v: "cost_reduction", l: "Cost reduction" },
  { v: "new_product", l: "New product" },
];

/** KPIs + funnel + aging + outcome + throughput bundle for a date range. */
export async function summary({ from, to, engineer = null, devType = null }) {
  const { data, error } = await supabase.rpc("npd_intel_summary", {
    p_from: from, p_to: to, p_engineer: engineer, p_dev_type: devType,
  });
  if (error) throw error;
  return data || {};
}

/** Distinct engineers + development types for the filter selects. Never throws. */
export async function filterOptions() {
  const projects = await npdService.listProjects().catch(() => []);
  const engineers = Array.from(
    new Set((projects || []).map((p) => p.npd_engineer_email).filter(Boolean)),
  ).sort();
  return { engineers, devTypes: DEV_TYPES };
}

const npdMetricsService = { summary, filterOptions, DEV_TYPES };
export default npdMetricsService;

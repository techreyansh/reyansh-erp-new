// Production Intelligence Center — operations analytics over the real shop-floor
// capture. Thin layer over the prod_intel_summary RPC + filter options.
import { supabase } from "../lib/supabaseClient";
import ppcService from "./ppcService";

const PRODUCIBLE_TYPES = ["cable", "power_cord", "harness", "finished_good", "semi_finished"];

/** KPI + trend + pareto bundle for a date range, optionally filtered. */
export async function summary({ from, to, lineId = null, productId = null }) {
  const { data, error } = await supabase.rpc("prod_intel_summary", {
    p_from: from, p_to: to, p_line: lineId, p_product: productId,
  });
  if (error) throw error;
  return data || {};
}

/** Lines + producible products for the filter selects. Never throws. */
export async function filterOptions() {
  const [lines, items] = await Promise.all([
    supabase.from("ppc_lines").select("id, name").order("name").then((r) => r.data || []).catch(() => []),
    ppcService.listItems({ includeInactive: false }).catch(() => []),
  ]);
  const products = (items || [])
    .filter((i) => PRODUCIBLE_TYPES.includes(i.item_type))
    .map((i) => ({ id: i.id, label: `${i.code} — ${i.name || ""}` }));
  return { lines: lines || [], products };
}

const productionMetricsService = { summary, filterOptions };
export default productionMetricsService;

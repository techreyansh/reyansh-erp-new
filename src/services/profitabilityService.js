// Profitability Intelligence Center — data layer. CEO-only (enforced by RLS +
// is_super_admin() on every table/RPC). Reads the profit_summary engine; CRUD on
// the cost-head master / overrides / expenses; client-side what-if.
import { supabase } from "../lib/supabaseClient";

export async function summary({ from, to, basis = "ordered", filters = {} }) {
  const { data, error } = await supabase.rpc("profit_summary", {
    p_from: from, p_to: to, p_basis: basis, p_filters: filters,
  });
  if (error) throw error;
  return data || {};
}

// ---- Cost-head master ----
export async function costHeads() {
  const { data, error } = await supabase.from("cost_head").select("*").order("sort_order");
  if (error) throw error;
  return data || [];
}
export async function saveCostHead(row) {
  const { error } = await supabase.from("cost_head").upsert(row);
  if (error) throw error;
}
export async function deleteCostHead(id) {
  const { error } = await supabase.from("cost_head").delete().eq("id", id);
  if (error) throw error;
}

// ---- Manual per-product cost override ----
export async function overrides() {
  const { data, error } = await supabase
    .from("profit_product_cost_override")
    .select("*, product:product_id(product_code, product_name)");
  if (error) throw error;
  return data || [];
}
export async function saveOverride(row) {
  const { error } = await supabase
    .from("profit_product_cost_override")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "product_id" });
  if (error) throw error;
}

// ---- Expense log ----
export async function expenses(month = null) {
  let q = supabase.from("expense_entry").select("*").order("entry_date", { ascending: false });
  if (month) q = q.eq("period_month", month);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
export async function saveExpense(row) {
  const period_month = (row.entry_date || "").slice(0, 7);
  const { error } = await supabase.from("expense_entry").upsert({ ...row, period_month });
  if (error) throw error;
}
export async function deleteExpense(id) {
  const { error } = await supabase.from("expense_entry").delete().eq("id", id);
  if (error) throw error;
}

// ---- Demo data (CEO) ----
export async function seedDemo() {
  const { data, error } = await supabase.rpc("profit_seed_demo");
  if (error) throw error;
  return data;
}
export async function clearDemo() {
  const { data, error } = await supabase.rpc("profit_clear_demo");
  if (error) throw error;
  return data;
}

// ---- What-if (client-side; never touches stored data) ----
// levers: { copperPct, pvcPct, conversionPct, sellingPricePct } (percent deltas)
export function whatIf(sum, levers = {}) {
  const k = sum?.kpis || {};
  const mb = sum?.material_breakdown || [];
  const num = (v) => Number(v || 0);
  const copper = mb.filter((m) => /COPPER/i.test(m.code || "")).reduce((a, m) => a + num(m.amount), 0);
  const pvc = mb.filter((m) => /PVC/i.test(m.code || "")).reduce((a, m) => a + num(m.amount), 0);
  const dMaterial = copper * num(levers.copperPct) / 100 + pvc * num(levers.pvcPct) / 100;
  const newRevenue = num(k.revenue) * (1 + num(levers.sellingPricePct) / 100);
  const newMaterial = num(k.material) + dMaterial;
  const newConversion = num(k.conversion) * (1 + num(levers.conversionPct) / 100);
  const newGP = newRevenue - newMaterial - newConversion;
  return {
    revenue: Math.round(newRevenue),
    material: Math.round(newMaterial),
    conversion: Math.round(newConversion),
    gross_profit: Math.round(newGP),
    gm_pct: newRevenue > 0 ? Math.round((newGP / newRevenue) * 1000) / 10 : 0,
    base_gp: num(k.gross_profit),
    delta_gp: Math.round(newGP - num(k.gross_profit)),
  };
}

const profitabilityService = {
  summary, costHeads, saveCostHead, deleteCostHead, overrides, saveOverride,
  expenses, saveExpense, deleteExpense, seedDemo, clearDemo, whatIf,
};
export default profitabilityService;

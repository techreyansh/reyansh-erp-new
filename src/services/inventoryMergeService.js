// Item-master merge: fold a generic ppc_items code (COPPER, PVC_INS, …) into a
// physical SKU. Thin layer over the inv_merge_preview / inv_merge_item RPCs
// (which do all the transactional repointing). The mapping is user-driven in the
// Merge Items screen.
import { supabase } from "../lib/supabaseClient";
import ppcService from "./ppcService";

// Generic / rate-master codes that live in ppc_items but represent material
// categories, not physical SKUs — the usual merge sources. (Operational rate
// codes like LABOUR_RATE are NOT in ppc_items, so they never appear here.)
export const GENERIC_CODES = new Set([
  "COPPER", "PVC_INS", "PVC_SHEATH", "PIN_6A", "PIN_16A",
  "CONNECTOR", "TERMINAL", "SLEEVE", "LABEL", "PACKING",
]);

export function isLikelyGeneric(item) {
  if (!item) return false;
  return GENERIC_CODES.has(String(item.code || "").toUpperCase());
}

export async function listItems() {
  return ppcService.listItems({ includeInactive: true });
}

export async function preview(fromCode, toCode) {
  const { data, error } = await supabase.rpc("inv_merge_preview", {
    p_from_code: fromCode, p_to_code: toCode,
  });
  if (error) throw error;
  return data; // { ...counts, blocked, block_reason } or { error }
}

export async function merge(fromCode, toCode) {
  const { data, error } = await supabase.rpc("inv_merge_item", {
    p_from_code: fromCode, p_to_code: toCode,
  });
  if (error) {
    const m = error.message || "";
    if (/not_authorized/i.test(m)) throw new Error("Only an admin can merge items.");
    if (/both_items_have_stock/i.test(m)) throw new Error("Both items carry stock — consolidate stock manually before merging.");
    if (/item_not_found/i.test(m)) throw new Error("One of the item codes was not found.");
    if (/same_item/i.test(m)) throw new Error("Source and target are the same item.");
    throw error;
  }
  return data; // { ok, merge_id, from_code, to_code }
}

export async function listMergeLog() {
  const { data, error } = await supabase
    .from("inv_item_merge_log")
    .select("merge_id, from_code, to_code, merged_by, merged_at")
    .order("merged_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return data || [];
}

const inventoryMergeService = { GENERIC_CODES, isLikelyGeneric, listItems, preview, merge, listMergeLog };
export default inventoryMergeService;

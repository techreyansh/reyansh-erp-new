// Inventory Phase 2 — UoM conversions + storage bins (additive; the inv_ledger
// stays in base UoM). Pure converters + CRUD over inv_uom_conversion / inv_bin.
import { supabase } from '../lib/supabaseClient';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 1 alt unit = factor base units → base qty. */
export const toBase = (altQty, factor) => num(altQty) * (num(factor) || 1);
/** base qty → alt units. */
export const fromBase = (baseQty, factor) => (num(factor) > 0 ? num(baseQty) / num(factor) : 0);

// ---- Bins ----
export async function listLocations() {
  const { data } = await supabase.from('inv_location').select('id, code, name').order('code', { ascending: true });
  return data || [];
}
export async function listBins(locationId) {
  let q = supabase.from('inv_bin').select('*, location:inv_location(code, name)').order('bin_code', { ascending: true });
  if (locationId) q = q.eq('location_id', locationId);
  const { data } = await q;
  return data || [];
}
export async function saveBin(b) {
  const row = { location_id: b.location_id, bin_code: b.bin_code, description: b.description || null, is_active: b.is_active !== false };
  if (b.id) { const { error } = await supabase.from('inv_bin').update(row).eq('id', b.id); if (error) throw error; }
  else { const { error } = await supabase.from('inv_bin').insert(row); if (error) throw error; }
  return true;
}
export async function deleteBin(id) { const { error } = await supabase.from('inv_bin').delete().eq('id', id); if (error) throw error; return true; }

// ---- UoM conversions (per item) ----
export async function listConversions(itemId) {
  if (!itemId) return [];
  const { data } = await supabase.from('inv_uom_conversion').select('*').eq('item_id', itemId).order('alt_uom', { ascending: true });
  return data || [];
}
export async function saveConversion(c) {
  const row = { item_id: c.item_id, alt_uom: c.alt_uom, factor_to_base: num(c.factor_to_base), is_default: !!c.is_default };
  if (c.id) { const { error } = await supabase.from('inv_uom_conversion').update(row).eq('id', c.id); if (error) throw error; }
  else { const { error } = await supabase.from('inv_uom_conversion').insert(row); if (error) throw error; }
  return true;
}
export async function deleteConversion(id) { const { error } = await supabase.from('inv_uom_conversion').delete().eq('id', id); if (error) throw error; return true; }

// ---- Item master (home bin) ----
export async function listItems() {
  const { data } = await supabase.from('ppc_items').select('id, code, name, uom, bin_id').order('code', { ascending: true });
  return data || [];
}
export async function setItemBin(itemId, binId) {
  const { error } = await supabase.from('ppc_items').update({ bin_id: binId || null }).eq('id', itemId);
  if (error) throw error;
  return true;
}

const inventoryUomBinService = {
  toBase, fromBase, listLocations, listBins, saveBin, deleteBin,
  listConversions, saveConversion, deleteConversion, listItems, setItemBin,
};
export default inventoryUomBinService;

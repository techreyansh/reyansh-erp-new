// Material Control System (Inventory redesign) — data layer on the PPC engine.
// Dashboard rollup + stock list with available = on_hand - reserved. Additive;
// reads ppc_items/ppc_stock (the canonical engine, now seeded).
import { supabase } from '../lib/supabaseClient';

const num = (v) => Number(v) || 0;

export async function dashboard() {
  const { data, error } = await supabase.rpc('inv_control_dashboard');
  if (error) throw error;
  return data || {};
}

const TYPE_GROUP = (t) => (t === 'raw_material' ? 'Raw Material' : t === 'semi_finished' ? 'Semi-Finished' : ['finished_good', 'cable', 'power_cord', 'harness'].includes(t) ? 'Finished Goods' : 'Component');

export async function listStock() {
  // Config (reorder/safety/max/location) lives on ppc_items; on_hand/reserved come
  // from the inv_balance ledger (single source of truth), summed across locations.
  const [{ data, error }, balRes] = await Promise.all([
    supabase.from('ppc_stock').select('ppc_items(id, code, name, item_type, uom, unit_cost, reorder_point, safety_stock, max_qty, location)'),
    supabase.from('inv_balance').select('item_id, on_hand, reserved'),
  ]);
  if (error) throw error;
  const onHand = new Map(); const reserved = new Map();
  (balRes.data || []).forEach((b) => {
    onHand.set(b.item_id, (onHand.get(b.item_id) || 0) + num(b.on_hand));
    reserved.set(b.item_id, (reserved.get(b.item_id) || 0) + num(b.reserved));
  });
  return (data || []).map((r) => {
    const it = r.ppc_items || {};
    const on = onHand.get(it.id) || 0; const res = reserved.get(it.id) || 0; const ro = num(it.reorder_point); const safety = num(it.safety_stock);
    return {
      item_id: it.id, code: it.code, name: it.name, type: it.item_type, group: TYPE_GROUP(it.item_type), uom: it.uom,
      unit_cost: num(it.unit_cost), on_hand: on, reserved: res, available: on - res,
      reorder: ro, safety, location: it.location,
      value: on * num(it.unit_cost),
      status: on <= 0 ? 'out' : (ro > 0 && on <= ro) ? 'reorder' : (safety > 0 && on <= safety) ? 'low' : 'ok',
    };
  }).sort((a, b) => a.name?.localeCompare(b.name));
}

/** Material-360 — movements ledger + suppliers for one item. */
export async function getMaterial360(itemId) {
  const [tx, vn] = await Promise.all([
    supabase.from('ppc_stock_transactions').select('quantity_delta, on_hand_after, transaction_type, reference_type, notes, created_at, created_by_email').eq('item_id', itemId).order('created_at', { ascending: false }).limit(50).then((r) => r.data || []).catch(() => []),
    supabase.from('ppc_item_vendors').select('vendor_code, vendor_name, is_preferred, lead_time_days, unit_cost, moq, last_quote_date').eq('item_id', itemId).then((r) => r.data || []).catch(() => []),
  ]);
  return { transactions: tx, vendors: vn };
}

const inventoryControlService = { dashboard, listStock, getMaterial360 };
export default inventoryControlService;

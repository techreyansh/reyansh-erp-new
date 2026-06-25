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
  const { data, error } = await supabase.from('ppc_stock')
    .select('on_hand, reserved, safety_stock, max_qty, location, ppc_items(id, code, name, item_type, uom, unit_cost, reorder_point)');
  if (error) throw error;
  return (data || []).map((r) => {
    const it = r.ppc_items || {};
    const on = num(r.on_hand); const res = num(r.reserved); const ro = num(it.reorder_point);
    return {
      item_id: it.id, code: it.code, name: it.name, type: it.item_type, group: TYPE_GROUP(it.item_type), uom: it.uom,
      unit_cost: num(it.unit_cost), on_hand: on, reserved: res, available: on - res,
      reorder: ro, safety: num(r.safety_stock), location: r.location,
      value: on * num(it.unit_cost),
      status: on <= 0 ? 'out' : (ro > 0 && on <= ro) ? 'reorder' : (num(r.safety_stock) > 0 && on <= num(r.safety_stock)) ? 'low' : 'ok',
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

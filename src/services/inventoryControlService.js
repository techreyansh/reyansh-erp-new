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
    .select('on_hand, reserved, reorder_point, safety_stock, max_qty, location, ppc_items(code, name, item_type, uom, unit_cost)');
  if (error) throw error;
  return (data || []).map((r) => {
    const it = r.ppc_items || {};
    const on = num(r.on_hand); const res = num(r.reserved); const ro = num(r.reorder_point);
    return {
      code: it.code, name: it.name, type: it.item_type, group: TYPE_GROUP(it.item_type), uom: it.uom,
      unit_cost: num(it.unit_cost), on_hand: on, reserved: res, available: on - res,
      reorder: ro, safety: num(r.safety_stock), location: r.location,
      value: on * num(it.unit_cost),
      status: on <= 0 ? 'out' : (ro > 0 && on <= ro) ? 'reorder' : (num(r.safety_stock) > 0 && on <= num(r.safety_stock)) ? 'low' : 'ok',
    };
  }).sort((a, b) => a.name?.localeCompare(b.name));
}

const inventoryControlService = { dashboard, listStock };
export default inventoryControlService;

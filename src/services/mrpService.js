// MRP — material requirements for released orders, rolled up from each order
// line's costing material lines × order qty. Pure aggregation + a fetch wrapper.
import { supabase } from '../lib/supabaseClient';

const OPEN_STATUSES = ['released', 'in_planning', 'in_production', 'partially_dispatched'];

/**
 * Pure aggregation.
 * @param lines     [{ qty, costing_version_id }]
 * @param versions  [{ id, qty_basis }]
 * @param matLines  [{ costing_id, category, material_code, qty, uom }] (material section)
 * @returns [{ code, name, uom, qty }] sorted by qty desc
 */
export function aggregateMrp(lines = [], versions = [], matLines = []) {
  const basisById = Object.fromEntries(versions.map((v) => [v.id, Number(v.qty_basis) || 1]));
  const matByCosting = new Map();
  for (const m of matLines) {
    if (!matByCosting.has(m.costing_id)) matByCosting.set(m.costing_id, []);
    matByCosting.get(m.costing_id).push(m);
  }
  const agg = {};
  for (const l of lines) {
    if (!l.costing_version_id) continue;
    const perPiece = (Number(l.qty) || 0) / (basisById[l.costing_version_id] || 1);
    for (const m of matByCosting.get(l.costing_version_id) || []) {
      const key = m.material_code || m.category || 'unknown';
      agg[key] ||= { code: m.material_code || '', name: m.category || key, uom: m.uom || '', qty: 0 };
      agg[key].qty += (Number(m.qty) || 0) * perPiece;
    }
  }
  return Object.values(agg).map((x) => ({ ...x, qty: +x.qty.toFixed(3) })).sort((a, b) => b.qty - a.qty);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Net gross requirements against on-hand stock.
 * Stock rows (stock_data) use physical SKUs/names; requirements use semantic
 * material codes — so we match by code first, then by normalized name, and
 * flag anything with no stock record as 'unmatched' (don't fake a zero).
 * @param materials [{ code, name, uom, qty }]
 * @param stock     [{ itemCode, itemName, currentStock, reorderPoint, unit }]
 * @returns [{ ...material, onHand|null, shortfall, status, stockItem }]
 */
export function netRequirements(materials = [], stock = []) {
  const byCode = new Map();
  const byName = new Map();
  for (const s of stock) {
    if (s.itemCode) byCode.set(norm(s.itemCode), s);
    if (s.itemName) byName.set(norm(s.itemName), s);
  }
  return materials.map((m) => {
    const match = byCode.get(norm(m.code)) || byName.get(norm(m.name)) || byName.get(norm(m.code));
    if (!match) return { ...m, onHand: null, shortfall: +Number(m.qty).toFixed(3), status: 'unmatched', stockItem: null };
    const onHand = Number(match.currentStock) || 0;
    const shortfall = Math.max(0, m.qty - onHand);
    return {
      ...m, onHand, shortfall: +shortfall.toFixed(3),
      status: shortfall > 0 ? 'short' : 'ok',
      stockItem: { code: match.itemCode, name: match.itemName, reorderPoint: Number(match.reorderPoint) || 0 },
    };
  });
}

export async function computeMrp() {
  const { data: orders } = await supabase.from('sales_order').select('id').in('status', OPEN_STATUSES);
  const orderIds = (orders || []).map((o) => o.id);
  if (!orderIds.length) return { materials: [], lineCount: 0, shortCount: 0, unmatchedCount: 0 };

  const { data: lines } = await supabase.from('sales_order_line')
    .select('qty, costing_version_id').in('so_id', orderIds).not('costing_version_id', 'is', null);
  const costingIds = [...new Set((lines || []).map((l) => l.costing_version_id))];
  if (!costingIds.length) return { materials: [], lineCount: (lines || []).length, shortCount: 0, unmatchedCount: 0 };

  const [{ data: versions }, { data: matLines }, { data: stock }] = await Promise.all([
    supabase.from('costing_version').select('id, qty_basis').in('id', costingIds),
    supabase.from('costing_line').select('costing_id, category, material_code, qty, uom').in('costing_id', costingIds).eq('section', 'material'),
    supabase.from('stock_data').select('itemCode, itemName, currentStock, reorderPoint, unit'),
  ]);
  const gross = aggregateMrp(lines || [], versions || [], matLines || []);
  const materials = netRequirements(gross, stock || []);
  return {
    materials, lineCount: (lines || []).length,
    shortCount: materials.filter((m) => m.status === 'short').length,
    unmatchedCount: materials.filter((m) => m.status === 'unmatched').length,
  };
}

const mrpService = { computeMrp, aggregateMrp, netRequirements };
export default mrpService;

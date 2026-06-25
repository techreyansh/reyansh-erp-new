import { supabase } from '../lib/supabaseClient';

/**
 * Inventory ledger service — the app-side API for the new perpetual stock
 * ledger (inv_ledger / inv_balance). Every stock movement goes through the
 * SECURITY DEFINER RPCs created in migration 20260624120000; nothing edits a
 * quantity directly. This is the single source of truth that replaces the
 * legacy `stock`/`finished_goods` sheets and `ppc_stock`.
 */

/**
 * Phase-1 location resolver. Until a receive screen with an explicit location
 * picker exists (Phase 2), map an item to its home store the same way the
 * opening-balance seed did: copper -> Copper Store, PVC -> PVC Store, else Store.
 */
export function resolveLocationCode(itemCode = '') {
  const c = String(itemCode).toUpperCase();
  if (/^CO\d/.test(c) || c === 'COPPER') return 'COPPER';
  if (/^PV\d/.test(c) || c.startsWith('PVC')) return 'PVC';
  return 'STORE';
}

async function rpc(fn, params) {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

const inventoryLedgerService = {
  resolveLocationCode,

  /** Goods receipt — add stock at landed rate (weighted-average valuation). */
  receive({ itemCode, qty, rate = null, locationCode, grnRef = null }) {
    return rpc('inv_receive', {
      p_item_code: itemCode,
      p_location_code: locationCode || resolveLocationCode(itemCode),
      p_qty: qty,
      p_rate: rate,
      p_ref_id: grnRef,
      p_ref_type: 'grn',
    });
  },

  /** Issue stock to production / kitting (decrement). */
  issue({ itemCode, qty, locationCode, ref = null, refType = 'work_order' }) {
    return rpc('inv_issue', {
      p_item_code: itemCode,
      p_location_code: locationCode || resolveLocationCode(itemCode),
      p_qty: qty,
      p_ref_id: ref,
      p_ref_type: refType,
    });
  },

  /** Dispatch finished goods (decrement). */
  dispatch({ itemCode, qty, locationCode, ref = null }) {
    return rpc('inv_dispatch', {
      p_item_code: itemCode,
      p_location_code: locationCode || resolveLocationCode(itemCode),
      p_qty: qty,
      p_ref_id: ref,
    });
  },

  /** Cycle-count correction — set on-hand to an absolute counted value. */
  adjust({ itemCode, newQty, locationCode, reason = 'cycle count' }) {
    return rpc('inv_adjust', {
      p_item_code: itemCode,
      p_location_code: locationCode || resolveLocationCode(itemCode),
      p_new_qty: newQty,
      p_reason: reason,
    });
  },

  /** Move stock between two locations (value carried). */
  transfer({ itemCode, fromCode, toCode, qty, ref = null }) {
    return rpc('inv_transfer', {
      p_item_code: itemCode,
      p_from_code: fromCode,
      p_to_code: toCode,
      p_qty: qty,
      p_ref_id: ref,
    });
  },

  /** Read current balances (for the new Inventory screen — P1.4). */
  async getBalances() {
    const { data, error } = await supabase
      .from('inv_balance')
      .select('item_id, location_id, on_hand, reserved, valuation_rate, stock_value, updated_at');
    if (error) throw new Error(error.message);
    return data || [];
  },

  /** Read recent ledger movements (audit / drill-down). */
  async getLedger({ limit = 200 } = {}) {
    const { data, error } = await supabase
      .from('inv_ledger')
      .select('*')
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },

  /** Recent movements for one item (newest first). */
  async getItemLedger(itemId, { limit = 50 } = {}) {
    if (!itemId) return [];
    const { data, error } = await supabase
      .from('inv_ledger')
      .select('id, location_id, movement_type, qty_delta, qty_after, valuation_rate, value_after, ref_type, ref_id, reason, posted_by, posted_at')
      .eq('item_id', itemId)
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Unified inventory view for the desktop screen: merges balances with the
   * item master, locations, and the reorder threshold (still on ppc_stock
   * during transition). One row per item x location with on-hand + value +
   * status. Returns { rows, locations }.
   */
  async getInventoryView() {
    const [balRes, itemRes, locRes, stockRes] = await Promise.all([
      supabase.from('inv_balance').select('item_id, location_id, on_hand, reserved, valuation_rate, stock_value, updated_at'),
      supabase.from('ppc_items').select('id, code, name, item_type, uom, is_active'),
      supabase.from('inv_location').select('id, code, name, kind'),
      supabase.from('ppc_stock').select('item_id, reorder_point'),
    ]);
    for (const r of [balRes, itemRes, locRes, stockRes]) {
      if (r.error) throw new Error(r.error.message);
    }
    const items = new Map((itemRes.data || []).map((i) => [i.id, i]));
    const locs = new Map((locRes.data || []).map((l) => [l.id, l]));
    const reorder = new Map((stockRes.data || []).map((s) => [s.item_id, Number(s.reorder_point) || 0]));

    const rows = (balRes.data || []).map((b) => {
      const item = items.get(b.item_id) || {};
      const loc = locs.get(b.location_id) || {};
      const onHand = Number(b.on_hand) || 0;
      const reservedQty = Number(b.reserved) || 0;
      const rp = reorder.get(b.item_id) || 0;
      let status = 'OK';
      if (onHand <= 0) status = 'Stock-out';
      else if (rp > 0 && onHand < rp) status = 'Reorder';
      return {
        itemId: b.item_id,
        code: item.code || '',
        name: item.name || '',
        type: item.item_type || '',
        uom: item.uom || '',
        locationCode: loc.code || '',
        locationName: loc.name || '',
        onHand,
        reserved: reservedQty,
        available: onHand - reservedQty,
        rate: Number(b.valuation_rate) || 0,
        value: Number(b.stock_value) || 0,
        reorder: rp,
        status,
        updatedAt: b.updated_at,
      };
    });
    rows.sort((a, b) => (a.locationCode || '').localeCompare(b.locationCode) || (a.code || '').localeCompare(b.code));
    return { rows, locations: (locRes.data || []) };
  },
};

export default inventoryLedgerService;

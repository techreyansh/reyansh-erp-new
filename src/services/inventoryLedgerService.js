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

  // Bin is OPTIONAL on every wrapper — omit `binCode` and the RPC resolves the
  // item's default bin (home bin, else the location DEFAULT), preserving the
  // pre-bin behavior for every caller that doesn't pass one.

  /** Goods receipt — add stock at landed rate (weighted-average valuation). */
  receive({ itemCode, qty, rate = null, locationCode, grnRef = null, binCode = null }) {
    return rpc('inv_receive', {
      p_item_code: itemCode,
      p_location_code: locationCode || resolveLocationCode(itemCode),
      p_qty: qty,
      p_rate: rate,
      p_ref_id: grnRef,
      p_ref_type: 'grn',
      p_bin_code: binCode,
    });
  },

  /** Issue stock to production / kitting (decrement). */
  issue({ itemCode, qty, locationCode, ref = null, refType = 'work_order', binCode = null }) {
    return rpc('inv_issue', {
      p_item_code: itemCode,
      p_location_code: locationCode || resolveLocationCode(itemCode),
      p_qty: qty,
      p_ref_id: ref,
      p_ref_type: refType,
      p_bin_code: binCode,
    });
  },

  /** Dispatch finished goods (decrement). */
  dispatch({ itemCode, qty, locationCode, ref = null, binCode = null }) {
    return rpc('inv_dispatch', {
      p_item_code: itemCode,
      p_location_code: locationCode || resolveLocationCode(itemCode),
      p_qty: qty,
      p_ref_id: ref,
      p_bin_code: binCode,
    });
  },

  /** Cycle-count correction — set on-hand at a bin to an absolute counted value. */
  adjust({ itemCode, newQty, locationCode, reason = 'cycle count', binCode = null }) {
    return rpc('inv_adjust', {
      p_item_code: itemCode,
      p_location_code: locationCode || resolveLocationCode(itemCode),
      p_new_qty: newQty,
      p_reason: reason,
      p_bin_code: binCode,
    });
  },

  /** Move stock between two locations and/or bins (value carried). */
  transfer({ itemCode, fromCode, toCode, qty, ref = null, fromBinCode = null, toBinCode = null }) {
    return rpc('inv_transfer', {
      p_item_code: itemCode,
      p_from_code: fromCode,
      p_to_code: toCode,
      p_qty: qty,
      p_ref_id: ref,
      p_from_bin_code: fromBinCode,
      p_to_bin_code: toBinCode,
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
   * item master, locations, and the reorder threshold (now on ppc_items).
   * One row per item x location x BIN with on-hand + value + status. Reorder
   * status is computed from the item's TOTAL on-hand (across bins/locations),
   * not the single bin row. Returns { rows, locations }.
   */
  async getInventoryView() {
    const [balRes, itemRes, locRes, reorderRes, binRes, convRes] = await Promise.all([
      supabase.from('inv_balance').select('item_id, location_id, bin_id, on_hand, reserved, valuation_rate, stock_value, updated_at'),
      supabase.from('ppc_items').select('id, code, name, item_type, uom, is_active, bin_id'),
      supabase.from('inv_location').select('id, code, name, kind'),
      supabase.from('ppc_items').select('id, reorder_point'),
      supabase.from('inv_bin').select('id, bin_code'),
      supabase.from('inv_uom_conversion').select('item_id, alt_uom, factor_to_base, is_default'),
    ]);
    // Core reads must succeed; bin/alt-unit reads are best-effort decoration —
    // a missing grant must not break the stock register.
    for (const r of [balRes, itemRes, locRes, reorderRes]) {
      if (r.error) throw new Error(r.error.message);
    }
    const items = new Map((itemRes.data || []).map((i) => [i.id, i]));
    const locs = new Map((locRes.data || []).map((l) => [l.id, l]));
    const reorder = new Map((reorderRes.data || []).map((i) => [i.id, Number(i.reorder_point) || 0]));
    const bins = new Map((binRes.data || []).map((b) => [b.id, b.bin_code]));
    // One display conversion per item: the default, else the first available.
    const convByItem = new Map();
    (convRes.data || []).forEach((c) => {
      const cur = convByItem.get(c.item_id);
      if (!cur || (c.is_default && !cur.is_default)) convByItem.set(c.item_id, c);
    });
    // Item-total on-hand (across all bins/locations) for a correct reorder status.
    const itemTotal = new Map();
    (balRes.data || []).forEach((b) => {
      itemTotal.set(b.item_id, (itemTotal.get(b.item_id) || 0) + (Number(b.on_hand) || 0));
    });

    const rows = (balRes.data || []).map((b) => {
      const item = items.get(b.item_id) || {};
      const loc = locs.get(b.location_id) || {};
      const onHand = Number(b.on_hand) || 0;
      const reservedQty = Number(b.reserved) || 0;
      const rp = reorder.get(b.item_id) || 0;
      const total = itemTotal.get(b.item_id) || 0;
      let status = 'OK';
      if (total <= 0) status = 'Stock-out';
      else if (rp > 0 && total < rp) status = 'Reorder';
      const conv = convByItem.get(b.item_id);
      const altFactor = conv ? Number(conv.factor_to_base) || 0 : 0;
      return {
        itemId: b.item_id,
        code: item.code || '',
        name: item.name || '',
        type: item.item_type || '',
        uom: item.uom || '',
        binId: b.bin_id || '',
        binCode: bins.get(b.bin_id) || '',
        altUom: conv ? conv.alt_uom : '',
        altFactor,
        altOnHand: altFactor > 0 ? onHand / altFactor : 0,
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
    rows.sort((a, b) => (a.locationCode || '').localeCompare(b.locationCode)
      || (a.code || '').localeCompare(b.code)
      || (a.binCode || '').localeCompare(b.binCode));
    return { rows, locations: (locRes.data || []) };
  },
};

export default inventoryLedgerService;

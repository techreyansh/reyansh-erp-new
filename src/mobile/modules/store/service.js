// Store module read helpers. Pickers + lookups for the 6 screens. Every read goes
// through the foundation cache so the pickers open offline from the last snapshot:
//   - PostgREST-backable reads use api.read(table, { cacheAs }) directly.
//   - The open-PO list comes from purchaseFlowService (sheet-backed, not a plain
//     table) so it can't go through api.read — we cache it manually via core/sync/cache.
//
// Entity cache keys here MUST match module.js offlineEntities so prefetch + offline
// fallback line up: ppc_items, inv_location, inv_balance, open_pos, open_wos.

import purchaseFlowService from '../../../services/purchaseFlowService';
import inventoryLedgerService from '../../../services/inventoryLedgerService';
import { supabase } from '../../../lib/supabaseClient';
import * as cache from '../../core/sync/cache';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** Items master — { id, code, name, uom }. Cached as ppc_items. */
export async function listItems(api) {
  return api.read('ppc_items', {
    select: 'id, code, name, uom, item_type, is_active',
    order: { col: 'code', ascending: true },
    cacheAs: 'ppc_items',
  });
}

/** Stock locations — { id, code, name, kind }. Cached as inv_location. */
export async function listLocations(api) {
  return api.read('inv_location', {
    select: 'id, code, name, kind',
    order: { col: 'code', ascending: true },
    cacheAs: 'inv_location',
  });
}

/** Current per-item/location balances. Cached as inv_balance. */
export async function listBalances(api) {
  return api.read('inv_balance', {
    select: 'item_id, location_id, on_hand, reserved, valuation_rate, stock_value, updated_at',
    cacheAs: 'inv_balance',
  });
}

/**
 * Open work orders eligible for kit issue (planned/released/in_progress).
 * Cached as open_wos so the Issue picker opens offline.
 */
export async function listOpenWOs(api) {
  return api.read('ppc_wo', {
    select: 'id, wo_number, item_id, qty, status',
    filters: [{ col: 'status', op: 'in', val: '(planned,released,in_progress)' }],
    order: { col: 'wo_number', ascending: true },
    cacheAs: 'open_wos',
  });
}

/**
 * Kit lines (BOM components) for a work order: required vs already issued.
 * Not part of the prefetch set (depends on a selected WO) — online read with a
 * per-WO cache fallback so a re-opened WO still works offline.
 */
export async function listKitLines(api, woId) {
  if (!woId) return [];
  const cacheKey = `kit_lines:${woId}`;
  if (isOnline()) {
    try {
      const { data, error } = await supabase
        .from('ppc_wo_material')
        .select('id, item_id, qty_required, qty_issued')
        .eq('work_order_id', woId);
      if (error) throw error;
      const rows = data || [];
      await cache.put(cacheKey, rows);
      return rows;
    } catch {
      return cache.get(cacheKey);
    }
  }
  return cache.get(cacheKey);
}

/**
 * Open POs ready to receive (GenerateGRN stage). Sheet-backed, so cached manually
 * under open_pos. Each PO carries POId + Items[] (qty/rate per line).
 */
export async function listOpenPOs() {
  if (isOnline()) {
    try {
      const pos = await purchaseFlowService.getPOsForGenerateGRN();
      const rows = Array.isArray(pos) ? pos : [];
      await cache.put('open_pos', rows);
      return rows;
    } catch {
      return cache.get('open_pos');
    }
  }
  return cache.get('open_pos');
}

/**
 * On-hand per location + recent movements for one item (Lookup screen).
 * Online: live ledger; the balances come from the cached inv_balance snapshot so
 * the per-location breakdown still renders offline. Movements are online-only
 * (best-effort) — empty when offline.
 * @returns {{ balances:Array, movements:Array }}
 */
export async function lookup(api, itemId) {
  if (!itemId) return { balances: [], movements: [] };
  const allBalances = await listBalances(api); // cached
  const balances = (allBalances || []).filter((b) => b.item_id === itemId);
  let movements = [];
  if (isOnline()) {
    try {
      movements = await inventoryLedgerService.getItemLedger(itemId, { limit: 25 });
    } catch {
      movements = [];
    }
  }
  return { balances, movements };
}

/**
 * Warm every offline entity for the module in one shot (called on module open).
 * Best-effort: failures fall back to whatever is already cached.
 */
export async function prefetch(api) {
  await Promise.allSettled([
    listItems(api),
    listLocations(api),
    listBalances(api),
    listOpenWOs(api),
    listOpenPOs(),
  ]);
}

export default {
  listItems,
  listLocations,
  listBalances,
  listOpenWOs,
  listKitLines,
  listOpenPOs,
  lookup,
  prefetch,
};

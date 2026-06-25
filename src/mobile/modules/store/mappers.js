// PURE intent mappers for the Store module. NO supabase, NO React, NO IDB — so
// these unit-test trivially (like src/services/routingCapacity.js). Each function
// returns a raw RPC intent `{ rpc, args }` matching the LIVE inv_* signatures:
//   inv_receive(p_item_code, p_location_code, p_qty, p_rate, p_ref_id, p_ref_type)
//   inv_issue  (p_item_code, p_location_code, p_qty, p_ref_id, p_ref_type)
//   inv_adjust (p_item_code, p_location_code, p_new_qty, p_reason)
//   inv_transfer(p_item_code, p_from_code, p_to_code, p_qty, p_ref_id)
//   inv_issue_kit_line(p_wo_material_id, p_qty)
//   inv_issue_kit(p_wo_id, p_allow_partial)
// The idempotencyKey is added by api.submit — mappers never touch it.

/** Coerce anything to a finite number (NaN/garbage -> 0). */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Pick the first defined, non-empty value (handles PO-line field-name variance). */
function firstOf(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// Where free-form / WIP locations resolve. STORE is the raw-material home; WIP is
// work-in-progress. Mirrors inv_location seed codes (STORE/COPPER/PVC/WIP/FG/SCRAP).
export const STORE_LOCATION = 'STORE';
export const WIP_LOCATION = 'WIP';

/**
 * Receive ONE open-PO line into stock at its landed rate. Tolerates the PO-line
 * field-name variance seen across the purchase flow:
 *   code : itemCode | ItemCode
 *   qty  : quantity | Quantity | qty
 *   rate : price | Price | rate | unitPrice  (PO carries the landed rate)
 *
 * @param {object} poLine  one entry from po.Items
 * @param {object} ctx     { grnRef, locationCode, qty }  overrides (qty = received qty)
 * @returns {{rpc:'inv_receive', args:object}}
 */
export function poLineToReceiveIntent(poLine = {}, ctx = {}) {
  const itemCode = firstOf(poLine.itemCode, poLine.ItemCode, poLine.item_code, poLine.code);
  const orderedQty = firstOf(poLine.quantity, poLine.Quantity, poLine.qty);
  const rate = firstOf(poLine.price, poLine.Price, poLine.rate, poLine.unitPrice, poLine.unit_price);
  const qty = ctx.qty != null && ctx.qty !== '' ? num(ctx.qty) : num(orderedQty);
  return {
    rpc: 'inv_receive',
    args: {
      p_item_code: itemCode != null ? String(itemCode) : null,
      p_location_code: ctx.locationCode || STORE_LOCATION,
      p_qty: qty,
      // A 0 / blank PO rate means "unspecified" → null, so we never book a
      // zero-cost receipt that would corrupt the weighted-average valuation.
      p_rate: num(rate) > 0 ? num(rate) : null,
      p_ref_id: ctx.grnRef != null ? String(ctx.grnRef) : null,
      p_ref_type: 'grn',
    },
  };
}

/**
 * Issue ONE WO kit line (req − issued). The ledger RPC takes the wo_material row id
 * + a qty; location/movement-type are decided server-side (MFG_CONSUME from STORE).
 *
 * @param {object} woMaterial  ppc_wo_material row (id, qty_required, qty_issued)
 * @param {number} qty         qty to issue now
 * @returns {{rpc:'inv_issue_kit_line', args:object}}
 */
export function woLineToIssueIntent(woMaterial = {}, qty) {
  const woMaterialId = firstOf(woMaterial.id, woMaterial.wo_material_id, woMaterial.woMaterialId);
  return {
    rpc: 'inv_issue_kit_line',
    args: {
      p_wo_material_id: woMaterialId != null ? woMaterialId : null,
      p_qty: num(qty),
    },
  };
}

/**
 * Issue the ENTIRE kit for a work order in one action.
 * @param {string|number} woId
 * @param {boolean} allowPartial  issue what's available when components are short
 * @returns {{rpc:'inv_issue_kit', args:object}}
 */
export function woToIssueKitIntent(woId, allowPartial = false) {
  return {
    rpc: 'inv_issue_kit',
    args: {
      p_wo_id: woId != null ? woId : null,
      p_allow_partial: allowPartial === true,
    },
  };
}

/**
 * Free-form material issue STORE → WIP (decrement). Used when there is no WO line,
 * e.g. ad-hoc consumption. ref_type 'manual_issue'.
 *
 * @param {string} itemCode
 * @param {number} qty
 * @param {object} ctx  { locationCode = STORE, ref, refType }
 * @returns {{rpc:'inv_issue', args:object}}
 */
export function freeIssueIntent(itemCode, qty, ctx = {}) {
  return {
    rpc: 'inv_issue',
    args: {
      p_item_code: itemCode != null ? String(itemCode) : null,
      p_location_code: ctx.locationCode || STORE_LOCATION,
      p_qty: num(qty),
      p_ref_id: ctx.ref != null ? String(ctx.ref) : null,
      p_ref_type: ctx.refType || 'manual_issue',
    },
  };
}

/**
 * Cycle-count adjustment — set on-hand to an absolute counted value at a location.
 *
 * @param {{itemCode:string, locationCode:string, countedQty:number, reason?:string}} p
 * @returns {{rpc:'inv_adjust', args:object}}
 */
export function countToAdjustIntent({ itemCode, locationCode, countedQty, reason } = {}) {
  return {
    rpc: 'inv_adjust',
    args: {
      p_item_code: itemCode != null ? String(itemCode) : null,
      p_location_code: locationCode || STORE_LOCATION,
      p_new_qty: num(countedQty),
      p_reason: reason || 'cycle count',
    },
  };
}

/**
 * Rack-to-rack transfer (OUT+IN) between two locations.
 *
 * @param {{itemCode:string, fromCode:string, toCode:string, qty:number, ref?:string}} p
 * @returns {{rpc:'inv_transfer', args:object}}
 */
export function transferIntent({ itemCode, fromCode, toCode, qty, ref } = {}) {
  return {
    rpc: 'inv_transfer',
    args: {
      p_item_code: itemCode != null ? String(itemCode) : null,
      p_from_code: fromCode || null,
      p_to_code: toCode || null,
      p_qty: num(qty),
      p_ref_id: ref != null ? String(ref) : null,
    },
  };
}

export default {
  STORE_LOCATION,
  WIP_LOCATION,
  poLineToReceiveIntent,
  woLineToIssueIntent,
  woToIssueKitIntent,
  freeIssueIntent,
  countToAdjustIntent,
  transferIntent,
};

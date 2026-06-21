/**
 * PPC (Production Planning & Control) — Phase 1 data service.
 *
 * Thin, error-handled wrapper over the LIVE Supabase PPC tables + RPCs.
 * Tables (permissive RLS for authenticated):
 *   ppc_items, ppc_bom, ppc_stock, ppc_lines, ppc_machines
 * RPCs:
 *   ppc_mrp(p_item_id, p_qty), ppc_low_stock()
 *
 * Every call throws a normalized Error on failure so callers can surface it.
 */
import { supabase } from '../lib/supabaseClient';

/** Throw a clean Error from a Supabase { data, error } response. */
function unwrap(res, context) {
  const { data, error } = res;
  if (error) {
    const msg = error.message || 'Unknown error';
    console.warn(`[ppcService] ${context}:`, msg);
    throw new Error(`${context}: ${msg}`);
  }
  return data;
}

export const ITEM_TYPES = [
  { value: 'cable', label: 'Cable' },
  { value: 'power_cord', label: 'Power Cord' },
  { value: 'harness', label: 'Harness' },
  { value: 'component', label: 'Component' },
  { value: 'raw_material', label: 'Raw Material' },
];

/** Item types that represent a finished / sellable product (can be MRP'd). */
export const FINISHED_TYPES = ['cable', 'power_cord', 'harness'];

export const itemTypeLabel = (type) =>
  ITEM_TYPES.find((t) => t.value === type)?.label || type || '—';

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
async function listItems({ includeInactive = true } = {}) {
  let query = supabase
    .from('ppc_items')
    .select('id, code, name, item_type, uom, unit_cost, is_active, notes')
    .order('code', { ascending: true });
  if (!includeInactive) query = query.eq('is_active', true);
  return unwrap(await query, 'List items') || [];
}

async function createItem(payload) {
  const row = {
    code: payload.code?.trim(),
    name: payload.name?.trim(),
    item_type: payload.item_type,
    uom: payload.uom?.trim() || 'nos',
    unit_cost: payload.unit_cost != null && payload.unit_cost !== '' ? Number(payload.unit_cost) : 0,
    is_active: payload.is_active ?? true,
    notes: payload.notes?.trim() || null,
  };
  const data = unwrap(
    await supabase.from('ppc_items').insert(row).select().single(),
    'Create item'
  );
  return data;
}

async function updateItem(id, patch) {
  const row = { ...patch };
  if (row.unit_cost != null && row.unit_cost !== '') row.unit_cost = Number(row.unit_cost);
  const data = unwrap(
    await supabase.from('ppc_items').update(row).eq('id', id).select().single(),
    'Update item'
  );
  return data;
}

async function deactivateItem(id) {
  return updateItem(id, { is_active: false });
}

async function activateItem(id) {
  return updateItem(id, { is_active: true });
}

// ---------------------------------------------------------------------------
// BOM
// ---------------------------------------------------------------------------
async function listBomForParent(parentId) {
  if (!parentId) return [];
  const data = unwrap(
    await supabase
      .from('ppc_bom')
      .select(
        'id, parent_item_id, component_item_id, qty_per, scrap_pct, sequence, notes, component:ppc_items!ppc_bom_component_item_id_fkey(id, name, code, uom, item_type)'
      )
      .eq('parent_item_id', parentId)
      .order('sequence', { ascending: true }),
    'List BOM'
  );
  return data || [];
}

async function addBomLine(payload) {
  const row = {
    parent_item_id: payload.parent_item_id,
    component_item_id: payload.component_item_id,
    qty_per: Number(payload.qty_per) || 0,
    scrap_pct: payload.scrap_pct != null && payload.scrap_pct !== '' ? Number(payload.scrap_pct) : 0,
    sequence: payload.sequence != null && payload.sequence !== '' ? Number(payload.sequence) : 0,
    notes: payload.notes?.trim() || null,
  };
  return unwrap(
    await supabase.from('ppc_bom').insert(row).select().single(),
    'Add BOM line'
  );
}

async function updateBomLine(id, patch) {
  const row = { ...patch };
  ['qty_per', 'scrap_pct', 'sequence'].forEach((k) => {
    if (row[k] != null && row[k] !== '') row[k] = Number(row[k]);
  });
  return unwrap(
    await supabase.from('ppc_bom').update(row).eq('id', id).select().single(),
    'Update BOM line'
  );
}

async function deleteBomLine(id) {
  unwrap(await supabase.from('ppc_bom').delete().eq('id', id), 'Delete BOM line');
  return true;
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------
async function listStock() {
  const data = unwrap(
    await supabase
      .from('ppc_stock')
      .select(
        'id, item_id, on_hand, reorder_point, safety_stock, lead_time_days, location, abc_class, xyz_class, item:ppc_items!ppc_stock_item_id_fkey(id, code, name, uom, item_type, unit_cost)'
      ),
    'List stock'
  );
  return data || [];
}

/**
 * Recompute ABC (value) / XYZ (demand-variability) classification for all stock
 * rows. Returns the count of items reclassified.
 */
async function recomputeClassification() {
  const data = unwrap(await supabase.rpc('ppc_recompute_classification'), 'Recompute classification');
  return data;
}

/** Insert or update a stock row keyed on the unique item_id. */
async function upsertStock(payload) {
  const row = {
    item_id: payload.item_id,
    on_hand: Number(payload.on_hand) || 0,
    reorder_point: Number(payload.reorder_point) || 0,
    safety_stock: Number(payload.safety_stock) || 0,
    lead_time_days: Number(payload.lead_time_days) || 0,
    location: payload.location?.trim() || null,
  };
  return unwrap(
    await supabase.from('ppc_stock').upsert(row, { onConflict: 'item_id' }).select().single(),
    'Save stock'
  );
}

// ---------------------------------------------------------------------------
// Stock movements (RPC) — receive, adjust, dispatch + transaction history
// ---------------------------------------------------------------------------

/** Receive stock against an item (auto-creates the stock row). Returns { ok, item_id, on_hand }. */
async function receiveStock(itemId, { qty, vendorCode, vendorName, unitCost, reference, note } = {}) {
  if (!itemId) throw new Error('Receive stock: an item must be selected');
  const data = unwrap(
    await supabase.rpc('ppc_receive_stock', {
      p_item_id: itemId,
      p_qty: Number(qty) || 0,
      p_vendor_code: vendorCode?.trim() || null,
      p_vendor_name: vendorName?.trim() || null,
      p_unit_cost: unitCost != null && unitCost !== '' ? Number(unitCost) : null,
      p_reference: reference?.trim() || null,
      p_note: note?.trim() || null,
    }),
    'Receive stock'
  );
  return data || null;
}

/** Set an item's on-hand to an exact quantity (cycle count / correction). Returns { ok, item_id, on_hand }. */
async function adjustStock(itemId, newQty, reason) {
  if (!itemId) throw new Error('Adjust stock: an item must be selected');
  const data = unwrap(
    await supabase.rpc('ppc_adjust_stock', {
      p_item_id: itemId,
      p_new_qty: Number(newQty) || 0,
      p_reason: reason?.trim() || null,
    }),
    'Adjust stock'
  );
  return data || null;
}

/** Dispatch / issue stock out to a customer (decrements on-hand). Returns { ok, item_id, on_hand }. */
async function dispatchStock(itemId, { qty, customer, reference } = {}) {
  if (!itemId) throw new Error('Dispatch stock: an item must be selected');
  const data = unwrap(
    await supabase.rpc('ppc_dispatch_stock', {
      p_item_id: itemId,
      p_qty: Number(qty) || 0,
      p_customer: customer?.trim() || null,
      p_reference: reference?.trim() || null,
    }),
    'Dispatch stock'
  );
  return data || null;
}

/** Recent stock transactions for an item, newest first. */
async function listStockTransactions(itemId) {
  if (!itemId) return [];
  const data = unwrap(
    await supabase
      .from('ppc_stock_transactions')
      .select('*')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(100),
    'List stock transactions'
  );
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Lines & Machines
// ---------------------------------------------------------------------------
async function listLines() {
  const data = unwrap(
    await supabase
      .from('ppc_lines')
      .select('id, name, line_type, sequence, is_active')
      .order('sequence', { ascending: true }),
    'List lines'
  );
  return data || [];
}

async function createLine(payload) {
  const row = {
    name: payload.name?.trim(),
    line_type: payload.line_type?.trim() || null,
    sequence: payload.sequence != null && payload.sequence !== '' ? Number(payload.sequence) : 0,
    is_active: payload.is_active ?? true,
  };
  return unwrap(await supabase.from('ppc_lines').insert(row).select().single(), 'Create line');
}

async function updateLine(id, patch) {
  const row = { ...patch };
  if (row.sequence != null && row.sequence !== '') row.sequence = Number(row.sequence);
  return unwrap(
    await supabase.from('ppc_lines').update(row).eq('id', id).select().single(),
    'Update line'
  );
}

async function listMachines() {
  const data = unwrap(
    await supabase
      .from('ppc_machines')
      .select(
        'id, line_id, name, machine_type, status, line:ppc_lines!ppc_machines_line_id_fkey(id, name)'
      )
      .order('name', { ascending: true }),
    'List machines'
  );
  return data || [];
}

async function createMachine(payload) {
  const row = {
    line_id: payload.line_id || null,
    name: payload.name?.trim(),
    machine_type: payload.machine_type?.trim() || null,
    status: payload.status || 'idle',
  };
  return unwrap(
    await supabase.from('ppc_machines').insert(row).select().single(),
    'Create machine'
  );
}

async function updateMachine(id, patch) {
  return unwrap(
    await supabase.from('ppc_machines').update(patch).eq('id', id).select().single(),
    'Update machine'
  );
}

// ---------------------------------------------------------------------------
// Cable Machine Master — full machine spec rows (Cable Production module)
// ---------------------------------------------------------------------------
// NOTE: listMachines() above returns a trimmed, line-joined shape for the
// existing PPC screens. The Cable Machine Master needs every spec column
// (speed, changeover, scrap, capacities, shift, …), so it has its own readers.

/** All machine-master rows with the full spec column set, ordered by code. */
async function listCableMachines() {
  const data = unwrap(
    await supabase.from('ppc_machines').select('*').order('code', { ascending: true }),
    'List cable machines'
  );
  return data || [];
}

/** Patch a machine-master row by id. Returns the updated row. */
async function updateCableMachine(id, patch) {
  if (!id) throw new Error('Update machine: no machine selected');
  return unwrap(
    await supabase.from('ppc_machines').update(patch).eq('id', id).select().single(),
    'Update cable machine'
  );
}

/** Insert a new machine-master row. Returns the created row. */
async function addCableMachine(row) {
  return unwrap(
    await supabase.from('ppc_machines').insert(row).select().single(),
    'Add cable machine'
  );
}

// Spec columns copied when duplicating a machine.
const MACHINE_SPEC_COLS = [
  'name', 'machine_type', 'stage', 'speed_m_per_hr', 'changeover_min', 'scrap_pct',
  'lay_reduction_pct', 'shift_start_hour', 'shift_hours', 'days_per_week',
  'drum_capacity_m', 'core_capacity_m', 'laying_drum_capacity_m', 'is_available',
];

/** Duplicate a machine: copy its specs under a new (auto-suffixed) code. */
async function duplicateCableMachine(row, newCode) {
  const copy = {};
  MACHINE_SPEC_COLS.forEach((k) => { if (row[k] !== undefined) copy[k] = row[k]; });
  copy.code = newCode || `${row.code || 'M'}-COPY`;
  copy.name = row.name ? `${row.name} (copy)` : copy.code;
  copy.status = 'idle';
  return addCableMachine(copy);
}

/** Archive (soft-delete) / restore a machine. */
async function archiveCableMachine(id, archived = true) {
  return updateCableMachine(id, { archived_at: archived ? new Date().toISOString() : null });
}

/** Hard-delete a machine-master row. */
async function deleteCableMachine(id) {
  if (!id) throw new Error('Delete machine: no machine selected');
  const { error } = await supabase.from('ppc_machines').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return true;
}

// ---------------------------------------------------------------------------
// MRP + low stock (RPC)
// ---------------------------------------------------------------------------
async function runMrp(itemId, qty) {
  if (!itemId) throw new Error('Run MRP: an item must be selected');
  const data = unwrap(
    await supabase.rpc('ppc_mrp', { p_item_id: itemId, p_qty: Number(qty) || 0 }),
    'Run MRP'
  );
  return data || null;
}

async function lowStock() {
  const data = unwrap(await supabase.rpc('ppc_low_stock'), 'Low stock');
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------------------
// Inventory dashboard — reorder board, excess stock, item↔vendor linkage
// ---------------------------------------------------------------------------

/**
 * Reorder / shortage board (RPC). Returns rows of items at/under reorder point
 * with suggested replenishment qty + preferred vendor. Never throws — returns []
 * so the dashboard renders even before the data/RPC exists.
 */
async function reorderBoard() {
  try {
    const { data, error } = await supabase.rpc('ppc_reorder_board');
    if (error) {
      console.warn('[ppcService] Reorder board:', error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[ppcService] Reorder board:', e.message);
    return [];
  }
}

/**
 * Excess / slow-moving stock (RPC). p_cover_threshold = days-of-cover above which
 * an item is flagged as excess. Never throws — returns [].
 */
async function excessStock(coverThreshold = 120) {
  try {
    const { data, error } = await supabase.rpc('ppc_excess_stock', {
      p_cover_threshold: Number(coverThreshold) || 120,
    });
    if (error) {
      console.warn('[ppcService] Excess stock:', error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[ppcService] Excess stock:', e.message);
    return [];
  }
}

/** Vendors linked to a given item, preferred first. */
async function listItemVendors(itemId) {
  if (!itemId) return [];
  const data = unwrap(
    await supabase
      .from('ppc_item_vendors')
      .select('*')
      .eq('item_id', itemId)
      .order('is_preferred', { ascending: false }),
    'List item vendors'
  );
  return data || [];
}

/**
 * Insert or update an item↔vendor link. If payload.id is present it updates,
 * otherwise inserts. When is_preferred is set true, first clears any other
 * preferred vendor for the item (to respect the one-preferred unique index).
 */
async function upsertItemVendor(payload) {
  const row = {
    item_id: payload.item_id,
    vendor_code: payload.vendor_code?.trim() || null,
    vendor_name: payload.vendor_name?.trim() || null,
    is_preferred: payload.is_preferred ?? false,
    lead_time_days:
      payload.lead_time_days != null && payload.lead_time_days !== ''
        ? Number(payload.lead_time_days)
        : null,
    unit_cost:
      payload.unit_cost != null && payload.unit_cost !== '' ? Number(payload.unit_cost) : null,
    moq: payload.moq != null && payload.moq !== '' ? Number(payload.moq) : null,
  };

  // Respect the one-preferred-per-item unique index: clear others first.
  if (row.is_preferred && row.item_id) {
    let clear = supabase
      .from('ppc_item_vendors')
      .update({ is_preferred: false })
      .eq('item_id', row.item_id);
    if (payload.id) clear = clear.neq('id', payload.id);
    unwrap(await clear, 'Clear preferred vendor');
  }

  if (payload.id) {
    return unwrap(
      await supabase.from('ppc_item_vendors').update(row).eq('id', payload.id).select().single(),
      'Update item vendor'
    );
  }
  return unwrap(
    await supabase.from('ppc_item_vendors').insert(row).select().single(),
    'Add item vendor'
  );
}

/** Delete an item↔vendor link by id. */
async function deleteItemVendor(id) {
  unwrap(await supabase.from('ppc_item_vendors').delete().eq('id', id), 'Delete item vendor');
  return true;
}

// ---------------------------------------------------------------------------
// Phase 2 — Shop Floor: Work Orders, Stages, Materials, QC
// ---------------------------------------------------------------------------

/** QC check types offered when recording a quality check on a stage / WO. */
export const QC_CHECK_TYPES = [
  'continuity',
  'hi_pot',
  'spark',
  'tensile',
  'sheath_thickness',
  'visual',
  'pull_test',
];

/** Work-order lifecycle: human label + MUI chip color per status. */
export const WO_STATUS = {
  planned: { label: 'Planned', color: 'default' },
  released: { label: 'Released', color: 'info' },
  in_progress: { label: 'In progress', color: 'primary' },
  qc: { label: 'QC', color: 'warning' },
  done: { label: 'Done', color: 'success' },
  cancelled: { label: 'Cancelled', color: 'error' },
};

export const woStatusLabel = (status) => WO_STATUS[status]?.label || status || '—';
export const woStatusColor = (status) => WO_STATUS[status]?.color || 'default';

/** Stage status → MUI chip color. */
export const STAGE_STATUS_COLOR = {
  pending: 'default',
  running: 'primary',
  done: 'success',
  blocked: 'error',
};

/** List all work orders, newest first, joined to item + line names. */
async function listWorkOrders() {
  const data = unwrap(
    await supabase
      .from('ppc_wo')
      .select(
        'id, wo_number, item_id, qty, line_id, status, priority, planned_start, planned_end, due_date, produced_qty, scrap_qty, owner_email, notes, created_at, ' +
          'customer_name, customer_code, source_order_number, source_kind, ' +
          'item:ppc_items!ppc_wo_item_id_fkey(id, name, code), line:ppc_lines!ppc_wo_line_id_fkey(id, name)'
      )
      .order('created_at', { ascending: false }),
    'List work orders'
  );
  return data || [];
}

/**
 * Create a work order for a CRM customer/order, then stamp the order link.
 * Calls the same ppc_create_work_order RPC, then updates the new ppc_wo row
 * with the customer + source-order metadata. Returns the RPC result (wo_number).
 */
async function createWorkOrderForCustomer({
  itemId,
  qty,
  lineId,
  due,
  customerCode,
  customerName,
  orderNumber,
  orderCycleId,
}) {
  if (!itemId) throw new Error('Create work order: an item must be selected');
  const result = unwrap(
    await supabase.rpc('ppc_create_work_order', {
      p_item_id: itemId,
      p_qty: Number(qty) || 0,
      p_line_id: lineId || null,
      p_due: due || null,
      p_stages: null,
    }),
    'Create work order for customer'
  );
  if (result?.id) {
    unwrap(
      await supabase
        .from('ppc_wo')
        .update({
          customer_code: customerCode || null,
          customer_name: customerName || null,
          source_order_number: orderNumber || null,
          source_kind: 'crm_order',
          crm_order_cycle_id: orderCycleId || null,
        })
        .eq('id', result.id),
      'Link work order to CRM order'
    );
  }
  return result || null;
}

/** List work orders linked to a given CRM order cycle, newest first. */
async function listWorkOrdersForOrderCycle(orderCycleId) {
  if (!orderCycleId) return [];
  const data = unwrap(
    await supabase
      .from('ppc_wo')
      .select('id, wo_number, status, qty, produced_qty, due_date')
      .eq('crm_order_cycle_id', orderCycleId)
      .order('created_at', { ascending: false }),
    'List work orders for order cycle'
  );
  return data || [];
}

/**
 * Create a work order via RPC. Pass stages = null (or empty) to let the
 * backend auto-derive the stage list from the item's routing/BOM.
 */
async function createWorkOrder({ itemId, qty, lineId, due, stages }) {
  if (!itemId) throw new Error('Create work order: an item must be selected');
  const stageArr = Array.isArray(stages) && stages.length ? stages : null;
  const data = unwrap(
    await supabase.rpc('ppc_create_work_order', {
      p_item_id: itemId,
      p_qty: Number(qty) || 0,
      p_line_id: lineId || null,
      p_due: due || null,
      p_stages: stageArr,
    }),
    'Create work order'
  );
  return data || null;
}

/** Fetch a single work order with its stages (ordered), materials and QC checks. */
async function getWorkOrder(id) {
  if (!id) return null;
  const wo = unwrap(
    await supabase
      .from('ppc_wo')
      .select(
        'id, wo_number, item_id, qty, line_id, status, priority, planned_start, planned_end, due_date, produced_qty, scrap_qty, owner_email, notes, ' +
          'item:ppc_items!ppc_wo_item_id_fkey(id, name, code, uom), line:ppc_lines!ppc_wo_line_id_fkey(id, name)'
      )
      .eq('id', id)
      .single(),
    'Get work order'
  );

  const [stages, materials, qc] = await Promise.all([
    supabase
      .from('ppc_wo_stage')
      .select(
        'id, work_order_id, stage_name, sequence, machine_id, operator_name, operator_email, method_sheet, status, output_qty, scrap_qty, started_at, completed_at, ' +
          'machine:ppc_machines!ppc_wo_stage_machine_id_fkey(id, name)'
      )
      .eq('work_order_id', id)
      .order('sequence', { ascending: true }),
    supabase
      .from('ppc_wo_material')
      .select(
        'id, work_order_id, item_id, qty_required, qty_issued, issued_by_email, issued_at, ' +
          'item:ppc_items!ppc_wo_material_item_id_fkey(id, name, code, uom)'
      )
      .eq('work_order_id', id),
    supabase
      .from('ppc_wo_qc')
      .select(
        'id, work_order_id, stage_id, check_type, result, measured_value, checked_by_email, checked_at, notes'
      )
      .eq('work_order_id', id)
      .order('checked_at', { ascending: false }),
  ]);

  return {
    ...wo,
    stages: unwrap(stages, 'Get WO stages') || [],
    materials: unwrap(materials, 'Get WO materials') || [],
    qc: unwrap(qc, 'Get WO QC') || [],
  };
}

/**
 * Kitting shortfall for a work order: per-material required vs. issued vs. on-hand.
 * Returns [{ item_id, code, name, uom, qty_required, qty_issued, on_hand, shortfall }].
 */
async function woShortage(woId) {
  if (!woId) return [];
  const data = unwrap(
    await supabase.rpc('ppc_wo_shortage', { p_wo_id: woId }),
    'Work order shortage'
  );
  return data ?? [];
}

/** Patch a stage's 4-M assignment fields (machine, operator, method sheet). */
async function updateStage(stageId, patch) {
  if (!stageId) throw new Error('Update stage: no stage selected');
  const allowed = ['machine_id', 'operator_name', 'operator_email', 'method_sheet'];
  const row = {};
  allowed.forEach((k) => {
    if (k in patch) row[k] = patch[k];
  });
  return unwrap(
    await supabase.from('ppc_wo_stage').update(row).eq('id', stageId).select().single(),
    'Update stage'
  );
}

/** Advance a stage (set running/done) recording output + scrap. */
async function advanceStage(stageId, status, output, scrap) {
  if (!stageId) throw new Error('Advance stage: no stage selected');
  const data = unwrap(
    await supabase.rpc('ppc_advance_stage', {
      p_stage_id: stageId,
      p_status: status,
      p_output: output != null && output !== '' ? Number(output) : 0,
      p_scrap: scrap != null && scrap !== '' ? Number(scrap) : 0,
    }),
    'Advance stage'
  );
  return data || null;
}

/**
 * Finish a cable work order and book its finished output into FG stock (once).
 * qty defaults to the WO's produced_qty / planned qty server-side. Returns
 * { ok, produced, on_hand, already_stocked }.
 */
async function finishWorkOrder(woId, qty) {
  if (!woId) throw new Error('Finish work order: no work order selected');
  const data = unwrap(
    await supabase.rpc('cable_finish_work_order', {
      p_wo_id: woId,
      p_qty: qty != null && qty !== '' ? Number(qty) : null,
    }),
    'Finish work order'
  );
  return data || null;
}

/** Issue material to a WO (decrements stock). */
async function issueMaterial(woMaterialId, qty) {
  if (!woMaterialId) throw new Error('Issue material: no material line selected');
  const data = unwrap(
    await supabase.rpc('ppc_issue_material', {
      p_wo_material_id: woMaterialId,
      p_qty: Number(qty) || 0,
    }),
    'Issue material'
  );
  return data || null;
}

/** Record a QC check against a WO (optionally tied to a stage). */
async function recordQc({ woId, stageId, checkType, result, value }) {
  if (!woId) throw new Error('Record QC: no work order selected');
  const data = unwrap(
    await supabase.rpc('ppc_record_qc', {
      p_wo_id: woId,
      p_stage_id: stageId || null,
      p_check_type: checkType,
      p_result: result,
      p_value: value != null ? String(value) : null,
    }),
    'Record QC'
  );
  return data || null;
}

/** Shop-floor board: active WOs (with nested stages) for an optional line. */
async function shopfloor(lineId) {
  const data = unwrap(
    await supabase.rpc('ppc_shopfloor', { p_line_id: lineId || null }),
    'Shop floor'
  );
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------------------
// Legacy BOM importer (one-time migration tool)
// ---------------------------------------------------------------------------

/**
 * Pull the legacy BOM source bundle for the guided importer.
 * Returns { boms, issues, already_imported }.
 */
export async function legacyBomSource() {
  const { data, error } = await supabase.rpc('ppc_legacy_bom_source');
  if (error) throw error;
  return data || { boms: [], issues: [], already_imported: 0 };
}

/**
 * Import a parsed/deduped legacy-BOM payload. Idempotent on the backend
 * (re-running upserts/links, never duplicates). Returns { items, boms, stock } counts.
 */
export async function importBom(payload) {
  const { data, error } = await supabase.rpc('ppc_import_bom', { payload });
  if (error) throw error;
  return data || { items: 0, boms: 0, stock: 0 };
}

const ppcService = {
  // items
  listItems,
  createItem,
  updateItem,
  deactivateItem,
  activateItem,
  // bom
  listBomForParent,
  addBomLine,
  updateBomLine,
  deleteBomLine,
  // stock
  listStock,
  recomputeClassification,
  upsertStock,
  receiveStock,
  adjustStock,
  dispatchStock,
  listStockTransactions,
  // lines / machines
  listLines,
  createLine,
  updateLine,
  listMachines,
  createMachine,
  updateMachine,
  // cable machine master (full spec rows)
  listCableMachines,
  updateCableMachine,
  addCableMachine,
  duplicateCableMachine,
  archiveCableMachine,
  deleteCableMachine,
  // mrp
  runMrp,
  lowStock,
  // inventory dashboard
  reorderBoard,
  excessStock,
  listItemVendors,
  upsertItemVendor,
  deleteItemVendor,
  // shop floor (Phase 2)
  listWorkOrders,
  createWorkOrder,
  createWorkOrderForCustomer,
  listWorkOrdersForOrderCycle,
  getWorkOrder,
  woShortage,
  updateStage,
  advanceStage,
  finishWorkOrder,
  issueMaterial,
  recordQc,
  shopfloor,
  // legacy import
  legacyBomSource,
  importBom,
  // constants
  ITEM_TYPES,
  FINISHED_TYPES,
  itemTypeLabel,
  QC_CHECK_TYPES,
  WO_STATUS,
  woStatusLabel,
  woStatusColor,
  STAGE_STATUS_COLOR,
};

export default ppcService;

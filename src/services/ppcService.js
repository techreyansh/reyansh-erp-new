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
        'id, item_id, on_hand, reorder_point, safety_stock, lead_time_days, location, item:ppc_items!ppc_stock_item_id_fkey(id, code, name, uom, item_type, unit_cost)'
      ),
    'List stock'
  );
  return data || [];
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
  upsertStock,
  // lines / machines
  listLines,
  createLine,
  updateLine,
  listMachines,
  createMachine,
  updateMachine,
  // mrp
  runMrp,
  lowStock,
  // constants
  ITEM_TYPES,
  FINISHED_TYPES,
  itemTypeLabel,
};

export default ppcService;

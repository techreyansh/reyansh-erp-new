/**
 * Cable Production — Phase 1b service.
 *
 * Production Plans CRUD over the LIVE Supabase `cable_production_plan` table,
 * plus auto-routing + MRP (material requirement) derived from the framework-free
 * cable planner engine (src/services/cablePlanner), and a "Release → Work Order"
 * path through the `cable_create_work_order` RPC.
 *
 * Engine import style mirrors cableMasterService.js: the planner's index.js is an
 * `export *` barrel, so the submodules are NOT named exports of the barrel. We
 * import each submodule's namespace directly (import * as scheduler from
 * './cablePlanner/scheduler') and call its flat named functions.
 */
import { supabase } from '../lib/supabaseClient';
import * as scheduler from './cablePlanner/scheduler';
import * as materials from './cablePlanner/materials';
import * as machineConfig from './cablePlanner/machineConfig';
import { toEngineMachines } from './cablePlanner/machineAdapter';
import { scheduleRowToJob } from './cablePlanner/erpAdapter';
import { toEngineCable, listCables } from './cableMasterService';
import ppcService from './ppcService';
import sheetService from './sheetService';

// Load the Machine Master (ppc_machines) as engine machines, one per pipeline
// stage, falling back to the engine's DEFAULT_MACHINES for any stage the DB
// doesn't cover. So scheduling always has a complete bunching→…→sheathing line.
export async function loadEngineMachines() {
  try {
    const rows = await ppcService.listCableMachines();
    return toEngineMachines(rows || []);
  } catch {
    return toEngineMachines([]); // -> all DEFAULT_MACHINES
  }
}

// Read the SAVED Machine Schedules sheet as engine jobs (for capacity/calendar
// views that should reflect the committed schedule, not a fresh auto-run).
export async function loadSavedSchedule() {
  try {
    const rows = await sheetService.getSheetData('Machine Schedules');
    return (rows || []).map(scheduleRowToJob).filter((j) => j.machineId && j.startTime);
  } catch {
    return [];
  }
}

// Total production metres from a plan + cable row.
// Power cords: qty (pieces) × length per piece. Bulk cable: qty is already metres.
export function productionMetres(plan, cableRow) {
  const isPC = !!cableRow?.is_power_cord;
  if (isPC) {
    return (Number(plan.qty) || 0) * (Number(plan.length_m) || Number(cableRow?.cord_length) || 0);
  }
  return Number(plan.qty) || 0;
}

// Auto-routing chain for a cable: the required engine stages (+ Cutting for power cords).
export function computeRouting(cableRow) {
  const cable = toEngineCable(cableRow);
  const stages = scheduler.requiredStages(cable).map((s, i) => ({
    stage_name: (machineConfig.STAGE_LABEL && machineConfig.STAGE_LABEL[s.stage]) || s.stage,
    sequence: i,
    machine_stage: s.stage,
  }));
  if (cable.isPowerCord) {
    stages.push({ stage_name: 'Cutting', sequence: stages.length, machine_stage: 'cutting' });
  }
  return stages;
}

// Material Requirement (MRP) for a cable over a number of production metres.
// Maps the engine's { copper, ins, sh } kg totals to raw-material item codes.
export function computeMRP(cableRow, metres) {
  const cable = toEngineCable(cableRow);
  const rm = materials.estimateRM(cable, metres) || {};
  return [
    { code: 'CO001', name: 'Copper', kind: 'copper', qty_required: +(Number(rm.copper) || 0).toFixed(1) },
    { code: 'PV003', name: 'PVC Insulation', kind: 'pvc_ins', qty_required: +(Number(rm.ins) || 0).toFixed(1) },
    { code: 'PV001', name: 'PVC Sheath', kind: 'pvc_sheath', qty_required: +(Number(rm.sh) || 0).toFixed(1) },
  ].filter((m) => m.qty_required > 0);
}

// On-hand stock for a set of item codes → { code: on_hand }.
export async function stockFor(codes) {
  if (!codes.length) return {};
  const { data, error } = await supabase
    .from('ppc_items')
    .select('code, ppc_stock(on_hand)')
    .in('code', codes);
  if (error) return {};
  const out = {};
  (data || []).forEach((r) => {
    const st = Array.isArray(r.ppc_stock) ? r.ppc_stock[0] : r.ppc_stock;
    out[r.code] = st ? Number(st.on_hand) || 0 : 0;
  });
  return out;
}

export async function listPlans() {
  const { data, error } = await supabase
    .from('cable_production_plan')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function savePlan(plan) {
  const row = { ...plan };
  if (plan.id) {
    const { data, error } = await supabase
      .from('cable_production_plan')
      .update(row)
      .eq('id', plan.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('cable_production_plan')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePlan(id) {
  const { error } = await supabase.from('cable_production_plan').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// Release a plan to a work order: compute routing + MRP, then call the RPC.
export async function releaseToWorkOrder(plan, cableRow) {
  const metres = productionMetres(plan, cableRow);
  const stages = computeRouting(cableRow);
  const mrp = computeMRP(cableRow, metres);
  const payload = {
    plan_id: plan.id,
    cable_code: cableRow.cable_code,
    product_name: cableRow.cable_name || plan.product_name,
    is_power_cord: !!cableRow.is_power_cord,
    qty: metres,
    due_date: plan.due_date,
    priority: plan.priority || 'medium',
    customer_code: plan.customer_code,
    customer_name: plan.customer_name,
    sales_order_number: plan.sales_order_number,
    stages,
    materials: mrp,
  };
  const { data, error } = await supabase.rpc('cable_create_work_order', { payload });
  if (error) throw error;
  return data;
}

// MRP dashboard: aggregate required materials across all non-completed plans,
// join on-hand stock, and compute shortfall per material code.
export async function mrpDashboard() {
  const plans = await listPlans();
  const cables = await listCables();
  const byId = Object.fromEntries(cables.map((c) => [c.id, c]));
  const byCode = Object.fromEntries(cables.map((c) => [String(c.cable_code).toLowerCase(), c]));
  const agg = {};
  for (const p of plans) {
    if (['completed', 'cancelled'].includes(p.status)) continue;
    const cab = byId[p.cable_id] || byCode[String(p.cable_code).toLowerCase()];
    if (!cab) continue;
    const metres = productionMetres(p, cab);
    computeMRP(cab, metres).forEach((m) => {
      agg[m.code] = agg[m.code] || { code: m.code, name: m.name, required: 0 };
      agg[m.code].required += m.qty_required;
    });
  }
  const codes = Object.keys(agg);
  const stock = await stockFor(codes);
  const rows = codes.map((c) => ({
    ...agg[c],
    required: +agg[c].required.toFixed(1),
    on_hand: stock[c] || 0,
    shortfall: Math.max(0, +(agg[c].required - (stock[c] || 0)).toFixed(1)),
  }));
  return { rows };
}

const cableProductionService = {
  productionMetres,
  computeRouting,
  computeMRP,
  stockFor,
  listPlans,
  savePlan,
  deletePlan,
  releaseToWorkOrder,
  mrpDashboard,
  loadEngineMachines,
  loadSavedSchedule,
};

export default cableProductionService;

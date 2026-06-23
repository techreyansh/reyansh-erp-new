// TEMPORARY — Cable Planning Workbench service. buildPlan is PURE and reuses the
// existing cablePlanner engine (routing/geometry/material). CRUD persists to the
// standalone temp_cable_plans table. No ERP integration (bridge tool).
import { supabase } from '../../lib/supabaseClient';
import {
  requiredStages, cableGeometry, estimateRM, STAGE_LABEL, DEFAULT_MACHINES, DEFAULT_CORE_COLORS,
} from '../cablePlanner/index.js';

const machineFor = (stage) => DEFAULT_MACHINES.find((m) => m.stage === stage)?.name || '—';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const WASTAGE = 0.05; // estimated process wastage on top of the engine's 4% copper draw loss

/**
 * PURE: turn manual order + cable inputs into a full production plan via the
 * existing cable engine. Returns { routing, stages, geometry, totalMeters,
 * material, departments } — no network.
 */
export function buildPlan(input = {}) {
  const cores = Number(input.cores) || 1;
  const size = Number(input.conductorSize) || 0;
  const numStrands = Number(input.numStrands) || 0;
  const orderQty = Number(input.orderQty) || 0;
  const lengthEach = Number(input.requiredLength || input.cableLength) || 0;
  const shThick = cores >= 2 ? 0.9 : 0;
  const cable = { size, cores, strandCount: numStrands, insThick: 0.6, shThick };

  const stages = requiredStages(cable);             // auto-routing per the engine rules
  const has = (s) => stages.some((x) => x.stage === s);
  const geo = cableGeometry(cable);
  const totalMeters = r2(orderQty * lengthEach);
  const rm = estimateRM(cable, totalMeters);        // { copper, ins, sh } kg
  const colours = input.coreColours || (DEFAULT_CORE_COLORS[cores] || []).join(', ');

  const departments = {
    bunching: has('bunching') ? {
      required: true, cable: input.cableDescription || `${cores}C ${size}sqmm`,
      strandConstruction: input.strandConstruction || `${numStrands} strands`,
      quantity: `${totalMeters.toLocaleString('en-IN')} m`, machine: machineFor('bunching'),
      target: '', remarks: '',
    } : { required: false, reason: `< ${24} strands → direct core extrusion` },
    core: {
      required: true, colour: colours, size: `${size} sqmm`,
      length: `${totalMeters.toLocaleString('en-IN')} m`, od: `${geo.insOd} mm`,
      machine: machineFor('core'), target: '', remarks: '',
    },
    laying: has('laying') ? {
      required: true, cores, length: `${totalMeters.toLocaleString('en-IN')} m`,
      drum: `${Math.max(1, Math.ceil(totalMeters / 1000))} drum(s)`, machine: machineFor('laying'),
      target: '', remarks: '',
    } : { required: false, reason: cores === 1 ? '1 core → no laying' : '2 cores → direct to sheathing' },
    sheathing: has('sheathing') ? {
      required: true, shape: input.shape || 'Round', finishedOd: `${input.finishedOd || geo.outerOd} mm`,
      length: `${totalMeters.toLocaleString('en-IN')} m`, machine: machineFor('sheathing'),
      target: '', remarks: '',
    } : { required: false, reason: 'single-core wire → no sheath' },
  };

  const pvcTotal = rm.ins + rm.sh;
  const material = {
    copper: r3(rm.copper), pvcIns: r3(rm.ins), pvcSheath: r3(rm.sh), pvcTotal: r3(pvcTotal),
    wastagePct: WASTAGE * 100,
    estWastageCopper: r3(rm.copper * WASTAGE), estWastagePvc: r3(pvcTotal * WASTAGE),
    copperWithWastage: r3(rm.copper * (1 + WASTAGE)), pvcWithWastage: r3(pvcTotal * (1 + WASTAGE)),
  };

  return {
    routing: stages.map((s) => ({ stage: s.stage, label: STAGE_LABEL[s.stage] })),
    flow: ['bunching', 'core', 'laying', 'sheathing'].map((s) => ({ stage: s, label: STAGE_LABEL[s], required: has(s) })),
    geometry: geo, totalMeters, material, departments,
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
async function nextPlanNumber() {
  const d = new Date();
  const prefix = `CP-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const { data } = await supabase.from('temp_cable_plans').select('plan_number').ilike('plan_number', `${prefix}-%`);
  let max = 0;
  (data || []).forEach((r) => { const n = parseInt(String(r.plan_number).split('-').pop(), 10); if (n > max) max = n; });
  return `${prefix}-${pad(max + 1, 3)}`;
}

const FIELDS = ['customer_name', 'product_name', 'cable_description', 'order_qty', 'required_length', 'delivery_date',
  'priority', 'remarks', 'cores', 'shape', 'conductor_size', 'strand_construction', 'num_strands', 'core_colours',
  'finished_od', 'cable_length'];

function toRow(input) {
  const row = {};
  FIELDS.forEach((f) => {
    const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    let v = input[camel] ?? input[f];
    if (['order_qty', 'required_length', 'cores', 'conductor_size', 'num_strands', 'finished_od', 'cable_length'].includes(f)) v = v === '' || v == null ? null : Number(v);
    if (f === 'delivery_date' && (v === '' || v == null)) v = null;
    row[f] = v ?? null;
  });
  return row;
}

export async function listPlans() {
  const { data, error } = await supabase.from('temp_cable_plans').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function savePlan(input, plan, id = null) {
  let email = null;
  try { email = (await supabase.auth.getUser()).data?.user?.email || null; } catch { /* ignore */ }
  const row = { ...toRow(input), plan, planner_email: email, updated_at: new Date().toISOString() };
  if (id) {
    const { data, error } = await supabase.from('temp_cable_plans').update(row).eq('id', id).select().single();
    if (error) throw error; return data;
  }
  row.plan_number = await nextPlanNumber();
  const { data, error } = await supabase.from('temp_cable_plans').insert(row).select().single();
  if (error) throw error; return data;
}

export async function deletePlan(id) {
  const { error } = await supabase.from('temp_cable_plans').delete().eq('id', id);
  if (error) throw error;
}

export async function duplicatePlan(id) {
  const { data: src } = await supabase.from('temp_cable_plans').select('*').eq('id', id).single();
  if (!src) throw new Error('Plan not found');
  const { id: _id, plan_number: _pn, created_at: _c, updated_at: _u, ...rest } = src;
  rest.plan_number = await nextPlanNumber();
  const { data, error } = await supabase.from('temp_cable_plans').insert(rest).select().single();
  if (error) throw error; return data;
}

const cablePlanService = { buildPlan, listPlans, savePlan, deletePlan, duplicatePlan };
export default cablePlanService;

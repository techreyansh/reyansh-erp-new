// TEMPORARY — Cable Planning Workbench service. buildPlan is PURE and reuses the
// existing cablePlanner engine (routing/geometry/material). CRUD persists to the
// standalone temp_cable_plans table. No ERP integration (bridge tool).
import { supabase } from '../../lib/supabaseClient';
import {
  requiredStages, cableGeometry, estimateRM, STAGE_LABEL, STAGE_ORDER,
  DEFAULT_MACHINES, CONST, coreColorsFor,
} from '../cablePlanner/index.js';

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const numOr = (v, dflt) => (v === '' || v == null ? dflt : Number(v));

/**
 * PURE: turn manual order + cable inputs into a full, execution-ready production
 * plan. Reuses the cable engine for routing/material. Corrected manufacturing
 * math: bunching length = finished × cores; laying loss inflates required core
 * production; planner-entered wastage % and Core OD; per-stage machine capacity,
 * required hours, utilisation. Returns everything the master sheet + per-department
 * operator job cards need. No network.
 */
export function buildPlan(input = {}) {
  const cores = Number(input.cores) || 1;
  const size = Number(input.conductorSize) || 0;
  const numStrands = Number(input.numStrands) || 0;
  const strandDia = Number(input.strandConstruction) || 0; // "strand construction" = strand dia (mm)
  const orderQty = Number(input.orderQty) || 0;
  const lengthEach = Number(input.requiredLength || input.cableLength) || 0;
  const coreOd = Number(input.coreOd) || 0;
  const wastagePct = numOr(input.wastagePct, 2);          // planner-entered, default 2%
  const w = 1 + wastagePct / 100;
  const shThick = cores >= 2 ? 0.9 : 0;
  const cable = { size, cores, strandCount: numStrands, insThick: 0.6, shThick };

  const stages = requiredStages(cable);                   // auto-routing per engine rules
  const has = (s) => stages.some((x) => x.stage === s);
  const geo = cableGeometry(cable);
  const finishedOd = Number(input.finishedOd) || geo.outerOd;

  // Laying loss only applies when the cable is laid up (≥3 cores). Default 2%.
  const layingApplies = has('laying');
  const layingLossPct = layingApplies ? numOr(input.layingLossPct, 2) : 0;
  const layW = 1 + layingLossPct / 100;

  // Lengths (the core correction). Finished cable metres → required core
  // production (per core, compensating laying loss) → total core production.
  const finishedLength = r2(orderQty * lengthEach);
  const requiredCorePerCore = r2(finishedLength * layW);
  const totalCoreProduction = r2(requiredCorePerCore * cores);   // bunching = this

  const colourList = String(input.coreColours || '').split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  const colours = colourList.length ? colourList : coreColorsFor({ cores, coreColors: [] });
  const copperConstruction = numStrands && strandDia ? `${numStrands}/${strandDia}` : (numStrands ? `${numStrands} strands` : '');

  const machineOf = (stage) => DEFAULT_MACHINES.find((m) => m.stage === stage) || { name: '—', defaultSpeed: 500, shiftHrs: 8 };
  // Planner-editable machine capacity: per-stage speed (m/hr) + shift hours.
  // Falls back to the machine-master defaults when a field is left blank.
  const SPEED_KEY = { bunching: 'speedBunching', core: 'speedCore', laying: 'speedLaying', sheathing: 'speedSheathing' };
  const shiftHrs = Number(input.shiftHours) > 0 ? Number(input.shiftHours) : 8;
  const speedFor = (stage) => { const v = Number(input[SPEED_KEY[stage]]); return v > 0 ? v : (machineOf(stage).defaultSpeed || 0); };
  // Machine loading for a stage given the raw length it must process.
  const planStage = (stage, rawLength) => {
    const m = machineOf(stage);
    const planningLength = r2(rawLength * w);
    const speed = speedFor(stage);                              // m/hr (planner override or master default)
    const dailyCapacity = speed * shiftHrs;                     // m/day (one shift)
    const requiredHours = speed ? r2(planningLength / speed) : 0;
    return {
      machine: m.name, machineId: m.id, speed, shiftHrs, dailyCapacity,
      length: r2(rawLength), planningLength, requiredHours,
      days: shiftHrs ? r2(requiredHours / shiftHrs) : 0,
      utilizationPct: dailyCapacity ? r1((planningLength / dailyCapacity) * 100) : 0,
    };
  };

  // Per-core extrusion rows — every core planned independently.
  const corePlan = planStage('core', totalCoreProduction);
  const coreRows = Array.from({ length: cores }, (_, i) => ({
    coreNo: i + 1,
    colour: colours[i] || `Core ${i + 1}`,
    size, coreOd, strands: numStrands, strandDia, copperConstruction, insThick: 0.6,
    requiredLength: finishedLength,
    targetLength: r2(requiredCorePerCore * w),                 // with wastage
    requiredHours: planStage('core', requiredCorePerCore).requiredHours,
  }));

  const departments = {
    bunching: has('bunching')
      ? {
        required: true, ...planStage('bunching', totalCoreProduction),
        strands: numStrands, strandDia, copperConstruction, copperArea: size,
        note: `${cores} cores × ${finishedLength.toLocaleString('en-IN')} m`
          + (layingLossPct ? ` + ${layingLossPct}% laying loss` : ''),
      }
      : { required: false, reason: `< ${CONST.BUNCH_TRIGGER_STRANDS} strands → direct core extrusion` },
    core: { required: true, ...corePlan, rows: coreRows, colour: colours.join(', '), coreOd, insThick: 0.6, copperConstruction, strands: numStrands, strandDia },
    laying: has('laying')
      ? {
        required: true, ...planStage('laying', finishedLength), cores,
        colourCombination: colours.join(' / '), layingLossPct, coreOd,
        requiredCorePerCore, totalCoreProduction,
        drum: `${Math.max(1, Math.ceil(finishedLength / 1000))} drum(s)`,
      }
      : { required: false, reason: cores < CONST.LAYING_TRIGGER_CORES ? `< ${CONST.LAYING_TRIGGER_CORES} cores → no laying` : 'n/a' },
    sheathing: has('sheathing')
      ? {
        required: true, ...planStage('sheathing', finishedLength),
        shape: input.shape || 'Round', finishedOd, cores, colour: colours.join(', '),
      }
      : { required: false, reason: 'single-core wire → no sheath' },
  };

  const rm = estimateRM(cable, finishedLength);             // { copper, ins, sh } kg (cores baked in)
  const pvcTotal = rm.ins + rm.sh;
  const material = {
    copper: r3(rm.copper), pvcIns: r3(rm.ins), pvcSheath: r3(rm.sh), pvcTotal: r3(pvcTotal),
    wastagePct,
    estWastageCopper: r3(rm.copper * (w - 1)), estWastagePvc: r3(pvcTotal * (w - 1)),
    copperWithWastage: r3(rm.copper * w), pvcWithWastage: r3(pvcTotal * w),
  };

  // Machine-load summary + cumulative lead time (working days, one shift each).
  let cum = 0;
  const machineLoad = stages.map((s) => {
    const dp = departments[s.stage]; cum += (dp.days || 0);
    return {
      stage: s.stage, label: STAGE_LABEL[s.stage], machine: dp.machine,
      requiredLength: dp.planningLength, capacity: dp.dailyCapacity,
      hours: dp.requiredHours, days: dp.days, utilizationPct: dp.utilizationPct, cumulativeDays: r2(cum),
    };
  });

  const planned = (key) => (departments[key].required ? departments[key].planningLength : 0);
  return {
    config: {
      cores, shape: input.shape || 'Round', conductorSize: size, numStrands, strandDia,
      copperConstruction, coreOd, finishedOd, colours, wastagePct, layingLossPct,
    },
    geometry: geo, orderQty, lengthEach, finishedLength, requiredCorePerCore, totalCoreProduction,
    routing: stages.map((s) => ({ stage: s.stage, label: STAGE_LABEL[s.stage] })),
    flow: STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_LABEL[s], required: has(s) })),
    departments, material,
    summary: {
      finishedLength, cores, coreProductionLength: totalCoreProduction,
      bunchingLength: planned('bunching'), layingLength: planned('laying'), sheathingLength: planned('sheathing'),
      wastagePct, layingLossPct,
      totalPlannedLength: r2(planned('bunching') + departments.core.planningLength + planned('laying') + planned('sheathing')),
      leadDays: r2(cum), machineLoad,
    },
    // legacy alias kept so older callers/saved-plan readers don't break
    totalMeters: finishedLength,
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
  'finished_od', 'cable_length', 'core_od', 'wastage_pct', 'laying_loss_pct', 'report_language',
  'speed_bunching', 'speed_core', 'speed_laying', 'speed_sheathing', 'shift_hours'];
const NUMERIC = ['order_qty', 'required_length', 'cores', 'conductor_size', 'num_strands', 'finished_od', 'cable_length', 'core_od', 'wastage_pct', 'laying_loss_pct',
  'speed_bunching', 'speed_core', 'speed_laying', 'speed_sheathing', 'shift_hours'];

function toRow(input) {
  const row = {};
  FIELDS.forEach((f) => {
    const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    let v = input[camel] ?? input[f];
    if (NUMERIC.includes(f)) v = v === '' || v == null ? null : Number(v);
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

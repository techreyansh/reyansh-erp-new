/**
 * Plant Head dashboard aggregator.
 *
 * Reduces the REAL production tables to the KPIs / series a Plant Head needs:
 * production vs target, rejection %, machine loading, job status, quality
 * alerts, and dispatch readiness. Each fetch is isolated and degrades to empty
 * on a missing table / RLS denial instead of breaking the whole dashboard.
 *
 * Data sources (real):
 *   ppc_production_plans  — quantity (target), status, inventory_shortage, dates
 *   ppc_work_orders       — output (actual), defects, machine_id, status, times
 *   ppc_qc_reports        — result PASS/FAIL per work order
 *   machine_schedules     — planned machine load (jsonb record)
 *   dispatches            — dispatch readiness (jsonb record)
 *
 * NOTE: OEE, machine downtime and shift attendance are NOT captured anywhere in
 * the schema today (the MachineMonitoringDashboard is simulated). Those KPIs are
 * intentionally omitted here rather than faked; they need shop-floor
 * instrumentation (a machine_status_log / downtime table) to be real.
 */
import { supabase } from '../lib/supabaseClient';

const num = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const norm = (v) => (v == null || v === '' ? 'Unknown' : String(v).trim());
const sumBy = (arr, fn) => arr.reduce((acc, x) => acc + num(fn(x)), 0);

const countBy = (arr, fn) => {
  const m = new Map();
  arr.forEach((x) => {
    const k = fn(x);
    if (k == null) return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
};

const pairs = (map, { sort = true, limit } = {}) => {
  let out = Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  if (sort) out.sort((a, b) => b.value - a.value);
  if (limit && out.length > limit) out = out.slice(0, limit);
  return out;
};

async function fetchAll(table, columns = '*') {
  try {
    const { data, error } = await supabase.from(table).select(columns);
    if (error) {
      console.warn(`[plantDashboard] ${table}:`, error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn(`[plantDashboard] ${table} threw:`, e?.message || e);
    return [];
  }
}

/** Flatten a sheet-style row ({ record: {...} }) up to top level. */
const flat = (row) => ({ ...(row?.record || {}), ...row });

const isToday = (d) => {
  if (!d) return false;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return false;
  const now = new Date();
  return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
};

function dispatchIsPending(row) {
  const r = flat(row);
  if (String(r.Dispatched || '').toLowerCase() === 'yes') return false;
  const raw = r.DispatchStatus || r.dispatchStatus || row?.status || '';
  const token = String(raw).split('|')[0].trim().toUpperCase();
  return token !== 'COMPLETED' && token !== 'DELIVERED';
}

export async function getPlantSummary() {
  const [plans, workOrders, qcReports, schedules, dispatches] = await Promise.all([
    fetchAll('ppc_production_plans'),
    fetchAll('ppc_work_orders'),
    fetchAll('ppc_qc_reports'),
    fetchAll('machine_schedules'),
    fetchAll('dispatches'),
  ]);

  // ---- Production vs target ------------------------------------------------
  const targetQty = sumBy(plans, (p) => p.quantity);
  const producedQty = sumBy(workOrders, (w) => w.output);
  const achievement = targetQty > 0 ? producedQty / targetQty : 0;
  const producedToday = sumBy(
    workOrders.filter((w) => isToday(w.ended_at) || isToday(w.started_at)),
    (w) => w.output,
  );

  // ---- Rejection % ---------------------------------------------------------
  const totalDefects = sumBy(workOrders, (w) => w.defects);
  const totalGood = producedQty;
  const rejectionRate = totalGood + totalDefects > 0 ? totalDefects / (totalGood + totalDefects) : 0;
  const qcFail = qcReports.filter((q) => /fail/i.test(String(q.result || ''))).length;
  const qcTotal = qcReports.length;
  const qcFailRate = qcTotal > 0 ? qcFail / qcTotal : 0;

  // ---- Job status ----------------------------------------------------------
  const woStatus = (w) => norm(w.status).toUpperCase();
  const running = workOrders.filter((w) => woStatus(w) === 'RUNNING').length;
  const pendingJobs = workOrders.filter((w) => woStatus(w) === 'PENDING').length;
  const completedJobs = workOrders.filter((w) => woStatus(w) === 'COMPLETED').length;
  const failedJobs = workOrders.filter((w) => woStatus(w) === 'FAILED').length;
  const jobsByStatus = pairs(countBy(workOrders, woStatus));

  // ---- Machine loading -----------------------------------------------------
  const machineLoad = pairs(
    countBy(workOrders.filter((w) => w.machine_id), (w) => norm(w.machine_id)),
    { limit: 8 },
  );
  // Rejections by machine (Pareto) — where are defects concentrated?
  const defectsByMachineMap = new Map();
  workOrders.forEach((w) => {
    const m = norm(w.machine_id);
    if (m === 'Unknown') return;
    defectsByMachineMap.set(m, (defectsByMachineMap.get(m) || 0) + num(w.defects));
  });
  const rejectionByMachine = pairs(defectsByMachineMap, { limit: 6 }).filter((x) => x.value > 0);

  // ---- Plan health ---------------------------------------------------------
  const planStatus = (p) => norm(p.status).toUpperCase();
  const blockedPlans = plans.filter((p) => planStatus(p) === 'BLOCKED').length;
  const shortagePlans = plans.filter((p) => p.inventory_shortage === true).length;
  const inProgressPlans = plans.filter((p) => planStatus(p) === 'IN_PROGRESS').length;

  // Per-plan progress (top active plans) — target vs produced.
  const outputByPlan = new Map();
  workOrders.forEach((w) => {
    if (!w.production_plan_id) return;
    outputByPlan.set(w.production_plan_id, (outputByPlan.get(w.production_plan_id) || 0) + num(w.output));
  });
  const planProgress = plans
    .filter((p) => planStatus(p) !== 'COMPLETED')
    .map((p) => ({
      id: p.id,
      label: p.id ? `Plan ${String(p.id).slice(0, 8)}` : 'Plan',
      target: num(p.quantity),
      produced: outputByPlan.get(p.id) || 0,
      status: planStatus(p),
      shortage: p.inventory_shortage === true,
    }))
    .sort((a, b) => b.target - a.target)
    .slice(0, 6);

  // ---- Dispatch readiness --------------------------------------------------
  const pendingDispatch = dispatches.filter(dispatchIsPending).length;

  // ---- Machine schedule load (planned) -------------------------------------
  const scheduledByShift = pairs(countBy(schedules.map(flat).filter((s) => s.shift), (s) => norm(s.shift)));

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      targetQty,
      producedQty,
      producedToday,
      achievement,
      rejectionRate,
      qcFailRate,
      running,
      pendingJobs,
      completedJobs,
      failedJobs,
      pendingDispatch,
      planCount: plans.length,
      inProgressPlans,
      blockedPlans,
      shortagePlans,
      machineCount: machineLoad.length,
    },
    jobsByStatus,
    machineLoad,
    rejectionByMachine,
    planProgress,
    scheduledByShift,
    hasData: plans.length + workOrders.length > 0,
  };
}

const plantDashboardService = { getPlantSummary };
export default plantDashboardService;

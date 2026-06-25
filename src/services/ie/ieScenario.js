/**
 * IE planning engine — the optimizer (C1b contract). PURE + no network, so it
 * unit-tests without Supabase. WRAPS routingCapacity.js (does not modify it):
 * cable's CapacityPlanner/LineBalancing keep the exact engine + 16 tests.
 *
 * Manufacturing model (user-locked 2026-06-26):
 *  - FIXED total headcount pool — staffing is bounded by `headcountPool`, not
 *    free-add. Objective: the FEWEST operators that hold the target (min
 *    manpower), then OVERTIME only after the pool can't cover it, then report
 *    infeasible. Lexicographic: min manpower → min overtime → hit target.
 *  - Machine/molding ops are fixed capacity (operators can't speed them up);
 *    molding is a SHARED pool, so the caller passes each molding op's already
 *    capacity-capped throughput via `moldingCapByKey` (reuse mesCapacityService).
 *  - Greedy + explainable: every result carries a plain-English reason and the
 *    binding constraint. We report "lowest-cost plan found", never "optimal".
 *
 * Tie-break (determinism): equal need → lowest op index, then op key.
 */
import { standardRatePerHour, machineThroughput, operatorsFor } from '../routingCapacity';
import { planCost } from './costModel';

const n = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

/** Required line UPH to make `targetQty` good pcs in `hours`. */
export function requiredUph(targetQty, hours) {
  const h = n(hours);
  return h > 0 ? n(targetQty) / h : Infinity;
}

/** Effective max throughput of one op (machine = capped throughput; labour = rate × max operators). */
function opCapacity(r, moldingCapByKey) {
  if (r.constraintType === 'machine') {
    const capped = moldingCapByKey && moldingCapByKey[r.key] != null ? n(moldingCapByKey[r.key]) : machineThroughput(r);
    return capped;
  }
  const maxOps = r.parallelAllowed === false ? 1 : r.maxOps;
  return standardRatePerHour(r) * maxOps;
}

/**
 * Staff every labour station to hold `lineUph`; machine ops are fixed. Returns
 * the per-station plan, total operators, and the binding station that cannot
 * reach `lineUph` (null if all can).
 */
function staffFor(ops, lineUph, moldingCapByKey) {
  let totalOperators = 0;
  let totalMachines = 0;
  const stations = [];
  let binding = null;
  let bindingCap = Infinity;
  ops.forEach((r, i) => {
    if (r.constraintType === 'machine') {
      const cap = opCapacity(r, moldingCapByKey);
      totalMachines += n(r.parallelMachines, 1);
      stations.push({ key: r.key, label: r.label, machine: true, capacity: cap, operators: 0 });
      if (cap < lineUph && cap < bindingCap) { binding = { ...r, _i: i, kind: 'machine' }; bindingCap = cap; }
    } else {
      const need = operatorsFor(r, lineUph);          // clamped to max + parallelAllowed
      const cap = standardRatePerHour(r) * need;
      totalOperators += need;
      stations.push({ key: r.key, label: r.label, machine: false, operators: need, capacity: cap });
      if (cap < lineUph && cap < bindingCap) { binding = { ...r, _i: i, kind: 'labour' }; bindingCap = cap; }
    }
  });
  return { totalOperators, totalMachines, stations, binding, bindingCap };
}

/**
 * Plan a single order against the day's fixed headcount pool + shared molding cap.
 *
 * opts: { headcountPool, moldingCapByKey, targetQty, shiftHours, maxOvertimeHours=0, rates={} }
 * Returns { feasible, requiredUph, achievableUph, plan, overtimeHours, bottleneck, cost, reason, unlock }.
 */
export function planForTarget(resolvedOps = [], opts = {}) {
  const ops = resolvedOps.filter((r) => r && r.valid);
  const { headcountPool = Infinity, moldingCapByKey = null, targetQty = 0, shiftHours = 0, maxOvertimeHours = 0, rates = {} } = opts;

  if (!ops.length) {
    return { feasible: false, requiredUph: 0, achievableUph: 0, plan: null, overtimeHours: 0,
      bottleneck: null, cost: null, reason: 'No usable routing — set cycle times on the operations.', unlock: null };
  }

  const fmt = (x) => Math.round(n(x)).toLocaleString('en-IN');

  // 1) Min-manpower plan at full shift (no overtime).
  let hours = n(shiftHours);
  let req = requiredUph(targetQty, hours);
  let plan = staffFor(ops, req, moldingCapByKey);
  let overtimeHours = 0;

  // 2) If a MACHINE/molding op can't reach req, operators won't help — try overtime
  //    (more hours → lower req) up to the cap; else infeasible.
  const machineShort = () => plan.binding && plan.binding.kind === 'machine';
  const poolOver = () => plan.totalOperators > headcountPool;

  if (machineShort() || poolOver()) {
    for (let ot = 0.5; ot <= n(maxOvertimeHours) + 1e-9; ot += 0.5) {
      const p = staffFor(ops, requiredUph(targetQty, hours + ot), moldingCapByKey);
      if (!p.binding && p.totalOperators <= headcountPool) { plan = p; overtimeHours = ot; req = requiredUph(targetQty, hours + ot); break; }
    }
  }

  const feasible = !plan.binding && plan.totalOperators <= headcountPool;
  // achievable line UPH at the chosen plan = the min station capacity.
  const achievableUph = plan.stations.reduce((min, s) => Math.min(min, s.capacity), Infinity);
  const totalHours = hours + overtimeHours;
  const cost = planCost({ totalOperators: plan.totalOperators, totalMachines: plan.totalMachines, targetQty }, rates, hours, overtimeHours);

  // 3) Reasoning + (if infeasible) the smallest unlock.
  let reason; let unlock = null; let bottleneck = plan.binding ? { key: plan.binding.key, label: plan.binding.label, kind: plan.binding.kind } : null;
  if (feasible) {
    reason = overtimeHours > 0
      ? `Hit ${fmt(targetQty)}/day with ${plan.totalOperators} operators + ${overtimeHours}h overtime (the headcount pool of ${headcountPool} couldn't cover it on the plain shift). Cost/pc ₹${cost.costPerPc}.`
      : `Hit ${fmt(targetQty)}/day with ${plan.totalOperators} operators, no overtime. Cost/pc ₹${cost.costPerPc}.`;
  } else if (plan.binding && plan.binding.kind === 'machine') {
    bottleneck = { key: plan.binding.key, label: plan.binding.label, kind: 'machine' };
    const cap = opCapacity(plan.binding, moldingCapByKey);
    const maxDaily = cap * totalHours;
    reason = `Target not achievable: ${plan.binding.label} (molding/machine) caps the line at ${fmt(cap)}/hr → max ${fmt(maxDaily)}/day. Operators can't speed it up.`;
    unlock = { type: 'machine', station: plan.binding.label, maxDaily: Math.round(maxDaily), suggestions: ['Add a machine to the shared molding pool', 'Run overtime on this machine', 'Move the dispatch date out'] };
  } else {
    // Labour pool too small: the staffing that would hold the target exceeds the
    // pool. Report the operator shortfall (honest) rather than a pool-limited max
    // (which needs the full pool-constrained allocation — a later optimization).
    const need = plan.totalOperators;
    const short = Math.max(0, need - headcountPool);
    reason = `Target needs ${need} operators but the pool is ${headcountPool}${maxOvertimeHours ? ` (even allowing ${maxOvertimeHours}h overtime)` : ''} — short by ${short}.`;
    unlock = { type: 'labour', extraOperatorsNeeded: short, suggestions: [`Add ${short} to the headcount pool`, 'Allow more overtime', 'Move the dispatch date out'] };
  }

  return {
    feasible,
    requiredUph: +n(req).toFixed(1),
    achievableUph: Number.isFinite(achievableUph) ? Math.round(achievableUph) : 0,
    plan: { stations: plan.stations, totalOperators: plan.totalOperators, totalMachines: plan.totalMachines },
    overtimeHours,
    bottleneck,
    cost,
    reason,
    unlock,
  };
}

const ieScenario = { requiredUph, planForTarget };
export default ieScenario;

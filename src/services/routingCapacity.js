/**
 * Routing-driven capacity engine (Power Cord MES redesign, P2). Pure + no
 * network, so it unit-tests without Supabase config. Every number a planner
 * sees comes through here, read from the active routing (then mold, then the
 * Process Master default) — never the generic per-operation cycle time.
 *
 * See MES_ROUTING_REDESIGN_PLAN.md. Implements the /autoplan eng guards (M1):
 * no divide-by-zero, scrap clamped below 1, oee clamped to (0,1], min<=max.
 */

const num = (x) => (x == null || x === '' ? null : Number(x));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const firstNum = (...vals) => { for (const v of vals) { const n = num(v); if (n != null && !Number.isNaN(n)) return n; } return null; };

/**
 * Resolve one routing op's effective standard via the fallback chain
 * routing -> mold -> process default. Returns a normalized, guarded shape.
 * `valid` is false when there is no usable cycle time (engine emits 0, not NaN).
 */
export function resolveStandard(op = {}, mold = null, processDefault = {}) {
  const cycle = firstNum(op.cycle_time_sec, mold?.cycle_time_sec, processDefault.default_cycle_sec);
  const cavities = Math.max(1, firstNum(op.cavities, mold?.cavity_count) ?? 1);
  const outputPerCycle = Math.max(1, firstNum(op.output_per_cycle) ?? cavities);
  const oee = clamp(firstNum(op.oee, processDefault.default_oee) ?? 1, 0.01, 1);
  const scrapPct = clamp(firstNum(op.scrap_pct) ?? 0, 0, 0.99);
  const constraintType = op.constraint_type || processDefault.constraint_type || (cavities > 1 ? 'machine' : 'labour');
  const parallelMachines = Math.max(1, firstNum(op.parallel_machines) ?? 1);
  // Whether multiple operators may work this station in parallel. Default true;
  // a station flagged parallel_allowed=false can hold at most ONE operator.
  const parallelAllowed = op.parallel_allowed != null ? !!op.parallel_allowed
    : (processDefault.parallel_allowed != null ? !!processDefault.parallel_allowed : true);

  let minOps = Math.max(1, firstNum(op.min_operators) ?? 1);
  let maxOps = Math.max(1, firstNum(op.max_operators) ?? 99);
  if (minOps > maxOps) { const t = minOps; minOps = maxOps; maxOps = t; } // correct bad data

  const valid = cycle != null && cycle > 0;
  return {
    key: op.key || op.id || op.step_name || op.operation_code || null,
    label: op.step_name || op.operation_code || op.key || 'Operation',
    cycle: valid ? cycle : 0,
    cavities, outputPerCycle, oee, scrapPct, constraintType, parallelMachines,
    parallelAllowed, minOps, maxOps,
    moldBound: !!(op.mold_id || mold?.id),
    // provenance: did this op carry its own cycle, or did it fall back? (UI badge)
    cycleSource: num(op.cycle_time_sec) != null ? 'routing' : (num(mold?.cycle_time_sec) != null ? 'mold' : 'default'),
    valid,
  };
}

/** Good-output pcs/hr for a SINGLE machine (or single operator on a labour op). */
export function standardRatePerHour(r) {
  if (!r || !r.valid || r.cycle <= 0) return 0;
  const perCycle = r.constraintType === 'machine' ? r.outputPerCycle : 1;
  const gross = (3600 / r.cycle) * perCycle * r.oee;
  return Math.round(gross * (1 - r.scrapPct));
}

/** Throughput of a machine op at its allowed parallel machines (good pcs/hr). */
export function machineThroughput(r) {
  return standardRatePerHour(r) * r.parallelMachines;
}

/**
 * Achievable line UPH + the binding op. Machine-constrained ops cap the line
 * (finite machines); labour ops are elastic (add operators), so a labour-only
 * line is capped by its slowest single-operator station as a baseline.
 */
export function lineCapacity(resolvedOps = []) {
  const usable = resolvedOps.filter((r) => r && r.valid);
  if (!usable.length) return { achievableUph: 0, bottleneck: null, ops: resolvedOps };

  // A labour op's MAX throughput is its single-operator rate times the most
  // operators it may run (1 if parallel isn't allowed). Machine ops are fixed.
  const labourMaxCap = (r) => standardRatePerHour(r) * (r.parallelAllowed === false ? 1 : r.maxOps);

  const machineOps = usable.filter((r) => r.constraintType === 'machine');
  let bottleneck;
  let achievableUph;
  if (machineOps.length) {
    bottleneck = machineOps.reduce((m, r) => (machineThroughput(r) < machineThroughput(m) ? r : m));
    achievableUph = machineThroughput(bottleneck);
    // A labour op that can't reach the machine rate even fully staffed caps the
    // line lower — otherwise we'd report a target a maxed-out station can't hold.
    for (const r of usable) {
      if (r.constraintType === 'machine') continue;
      const cap = labourMaxCap(r);
      if (cap < achievableUph) { achievableUph = cap; bottleneck = r; }
    }
  } else {
    // Labour-only baseline = slowest single-operator station (scale up via operatorsFor).
    bottleneck = usable.reduce((m, r) => (standardRatePerHour(r) < standardRatePerHour(m) ? r : m));
    achievableUph = standardRatePerHour(bottleneck);
  }
  return { achievableUph, bottleneck, ops: resolvedOps };
}

/**
 * FORWARD line-balance: given the resources actually deployed at each station
 * (operators on a labour op, machines/stations on a machine op), compute the
 * achievable line UPH and which station gates it. The inverse of operatorsFor:
 * "I have this crew — what can the line do?" rather than "what crew do I need?".
 *
 * `resourcesByKey` maps a resolved op's `key` to the count deployed there.
 * Missing/zero counts default to 1 station so an unfilled field never zeroes the
 * whole line silently. Line UPH = the slowest station's throughput.
 */
export function forwardLine(resolvedOps = [], resourcesByKey = {}) {
  const usable = (resolvedOps || []).filter((r) => r && r.valid);
  const rows = usable.map((r) => {
    const perUnit = standardRatePerHour(r); // one operator (labour) or one machine
    const raw = firstNum(resourcesByKey?.[r.key]);
    const count = Math.max(1, raw == null ? 1 : Math.floor(raw));
    return { r, key: r.key, label: r.label, type: r.constraintType, count, perUnit, throughput: perUnit * count };
  });
  if (!rows.length) return { achievableUph: 0, bottleneck: null, rows: [] };
  const slowest = rows.reduce((m, row) => (row.throughput < m.throughput ? row : m));
  return {
    achievableUph: slowest.throughput,
    bottleneck: slowest.r,
    rows: rows.map((row) => ({ ...row, bottleneck: row.key === slowest.key })),
  };
}

/** Operators a labour station needs to hold the given line rate, clamped to [min,max]. */
export function operatorsFor(r, lineUph) {
  if (!r || !r.valid) return 0;
  const rate = standardRatePerHour(r);
  // A station that doesn't allow parallel work holds at most one operator.
  const maxOps = r.parallelAllowed === false ? 1 : r.maxOps;
  const minOps = Math.min(r.minOps, maxOps);
  if (rate <= 0) return maxOps;
  return clamp(Math.ceil(lineUph / rate), minOps, maxOps);
}

const routingCapacity = { resolveStandard, standardRatePerHour, machineThroughput, lineCapacity, forwardLine, operatorsFor };
export default routingCapacity;

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

  let minOps = Math.max(1, firstNum(op.min_operators) ?? 1);
  let maxOps = Math.max(1, firstNum(op.max_operators) ?? 99);
  if (minOps > maxOps) { const t = minOps; minOps = maxOps; maxOps = t; } // correct bad data

  const valid = cycle != null && cycle > 0;
  return {
    key: op.key || op.id || op.step_name || op.operation_code || null,
    label: op.step_name || op.operation_code || op.key || 'Operation',
    cycle: valid ? cycle : 0,
    cavities, outputPerCycle, oee, scrapPct, constraintType, parallelMachines,
    minOps, maxOps,
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

  const machineOps = usable.filter((r) => r.constraintType === 'machine');
  let bottleneck;
  let achievableUph;
  if (machineOps.length) {
    bottleneck = machineOps.reduce((m, r) => (machineThroughput(r) < machineThroughput(m) ? r : m));
    achievableUph = machineThroughput(bottleneck);
  } else {
    bottleneck = usable.reduce((m, r) => (standardRatePerHour(r) < standardRatePerHour(m) ? r : m));
    achievableUph = standardRatePerHour(bottleneck);
  }
  return { achievableUph, bottleneck, ops: resolvedOps };
}

/** Operators a labour station needs to hold the given line rate, clamped to [min,max]. */
export function operatorsFor(r, lineUph) {
  if (!r || !r.valid) return 0;
  const rate = standardRatePerHour(r);
  if (rate <= 0) return r.maxOps;
  return clamp(Math.ceil(lineUph / rate), r.minOps, r.maxOps);
}

const routingCapacity = { resolveStandard, standardRatePerHour, machineThroughput, lineCapacity, operatorsFor };
export default routingCapacity;

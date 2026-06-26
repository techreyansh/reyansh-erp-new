// Pure molding-pool capacity (IE P3). The shared molding fleet feeds all assembly
// lines; this rolls each machine's daily good-pcs up by mold_type. Pure → testable.
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** Daily good pcs for ONE molding machine = cavities × (3600/cycle) × hours. */
export function machineDailyCapacity(m = {}) {
  const cycle = num(m.cycle_time_sec);
  if (cycle <= 0) return 0;
  const perHour = (3600 / cycle) * Math.max(1, num(m.cavities) || 1);
  return Math.round(perHour * num(m.available_hours));
}

/** Shared-pool daily capacity per mold_type across the active fleet. */
export function poolCapacityByType(machines = []) {
  const out = { inner: 0, outer: 0, grommet: 0 };
  (machines || []).filter((m) => m.is_active !== false).forEach((m) => {
    const t = m.mold_type || 'inner';
    out[t] = (out[t] || 0) + machineDailyCapacity(m);
  });
  return out;
}

/**
 * Per-machine molding schedule for one order. Each mold_type's demand is shared
 * across that type's active machines proportional to throughput, so all machines
 * of a type finish together (balanced makespan, minimal completion time). Pure.
 *
 * @param machines        ie_molding_machine[]
 * @param perTypeDemand   { inner, outer, grommet } pieces required per type
 * @param shiftStartHour  clock hour the shift begins (default 9)
 * @returns per-machine rows { machine, type, assignedQty, runHours, startHour, finishHour, utilization }
 */
export function scheduleMolding(machines = [], perTypeDemand = {}, shiftStartHour = 9) {
  const rate = (m) => (num(m.cycle_time_sec) > 0 ? (3600 / num(m.cycle_time_sec)) * Math.max(1, num(m.cavities) || 1) : 0);
  const active = (machines || []).filter((m) => m.is_active !== false && rate(m) > 0);
  const rows = [];
  ['inner', 'outer', 'grommet'].forEach((type) => {
    const demand = Math.max(0, num(perTypeDemand[type]));
    const mc = active.filter((m) => (m.mold_type || 'inner') === type);
    const totalRate = mc.reduce((s, m) => s + rate(m), 0);
    mc.forEach((m) => {
      const share = totalRate > 0 ? rate(m) / totalRate : 0;
      const assignedQty = Math.round(demand * share);
      const runHours = rate(m) > 0 ? assignedQty / rate(m) : 0;
      const avail = num(m.available_hours) || 8;
      rows.push({
        machine: m, type, assignedQty,
        runHours: +runHours.toFixed(2),
        startHour: shiftStartHour,
        finishHour: +(shiftStartHour + runHours).toFixed(2),
        utilization: avail > 0 ? Math.min(100, Math.round((runHours / avail) * 100)) : 0,
      });
    });
  });
  return rows;
}

const moldingPool = { machineDailyCapacity, poolCapacityByType, scheduleMolding };
export default moldingPool;

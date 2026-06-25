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

const moldingPool = { machineDailyCapacity, poolCapacityByType };
export default moldingPool;

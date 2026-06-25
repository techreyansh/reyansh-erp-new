/**
 * Daily auto-planner (Power Cord MES Phase 4). Pure, deterministic allocation
 * of open production demand across upcoming working days, capped by the shared
 * molding pool. No network here — the commit RPC lives in mesMasterService
 * (autoCommitPlan) so this module stays unit-testable without Supabase config.
 *
 * Decisions (see MES_AUTO_PLANNER_SPEC.md): due-date driven; shared molding
 * machines are the binding constraint; pool sized from molding_master; one
 * molding pass per unit; atomic commit via mes_auto_commit_plan.
 */

const num = (x) => Number(x) || 0;

/** One mold's capacity, pcs/hr — cavities x cycles/hr (mirrors mesCapacityService). */
function moldCapacityPerHour(cavityCount, cycleTimeSec) {
  const cav = num(cavityCount) || 1;
  const cyc = num(cycleTimeSec);
  if (cyc <= 0) return 0;
  return Math.round(cav * (3600 / cyc));
}

/** Daily molding pool, pcs/hr — sum of every active mold's cavities x cycles/hr. */
export function moldingPoolPerHour(molds = []) {
  return (molds || [])
    .filter((m) => (m.status || 'active') === 'active')
    .reduce((sum, m) => sum + moldCapacityPerHour(m.cavity_count, m.cycle_time_sec), 0);
}

/** N consecutive ISO dates (YYYY-MM-DD) from startIso, optionally skipping Sundays. */
export function buildWorkingDays(startIso, count, { skipSundays = false } = {}) {
  const days = [];
  let d = new Date(`${startIso}T00:00:00Z`);
  while (days.length < count && days.length < 366) {
    if (!(skipSundays && d.getUTCDay() === 0)) days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return days;
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, medium: 2, low: 3 };
const rank = (p) => (PRIORITY_RANK[(p || '').toLowerCase()] ?? 2);

/**
 * Greedy due-date allocation. Walks demands earliest-required first and fills
 * the earliest day that still has molding pool, splitting a demand across
 * consecutive days when it overflows a single day.
 *
 * @returns {{rows: Array, perDay: Array, lateCount: number, unplanned: number}}
 *   rows: one draft plan row per (demand, day) chunk with a `late` flag.
 *   perDay: [{date, used, capacity}] for the pool-usage bars.
 */
export function autoPlan({ demands = [], poolPerDay = 0, workingDays = [] }) {
  const cap = Math.max(0, Math.floor(poolPerDay));
  const free = workingDays.map(() => cap);
  const used = workingDays.map(() => 0);

  const open = demands
    .map((d) => ({ ...d, remaining: num(d.qty) - num(d.planned_qty) }))
    .filter((d) => d.remaining > 0)
    .sort((a, b) =>
      (a.required_date || '').localeCompare(b.required_date || '') || rank(a.priority) - rank(b.priority));

  const rows = [];
  const lateDemands = new Set();
  let unplanned = 0;
  let ptr = 0; // earliest day with free pool, shared so earlier-due demands get earlier days

  for (const d of open) {
    let remaining = d.remaining;
    let i = ptr;
    while (remaining > 0 && i < workingDays.length) {
      if (free[i] <= 0) { i++; continue; }
      const chunk = Math.min(remaining, free[i]);
      const plan_date = workingDays[i];
      const late = !!d.required_date && plan_date > d.required_date;
      rows.push({
        demand_id: d.id,
        product_id: d.product_id || null,
        product_name: d.product_name || null,
        so_number: d.so_number || null,
        priority: d.priority || 'normal',
        required_date: d.required_date || null,
        plan_date,
        planned_qty: chunk,
        late,
      });
      free[i] -= chunk; used[i] += chunk; remaining -= chunk;
      if (late) lateDemands.add(d.id);
      if (free[i] <= 0) i++;
    }
    if (remaining > 0) unplanned += remaining;
    while (ptr < workingDays.length && free[ptr] <= 0) ptr++;
  }

  const perDay = workingDays.map((date, idx) => ({ date, used: used[idx], capacity: cap }));
  return { rows, perDay, lateCount: lateDemands.size, unplanned };
}

const autoPlannerService = { moldingPoolPerHour, buildWorkingDays, autoPlan };
export default autoPlannerService;

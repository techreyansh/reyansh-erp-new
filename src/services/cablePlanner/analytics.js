// Decision-support analytics for the cable planner — order risk + machine load.
// Pure functions ported from the planner's orderRiskScore / machineLoadForecast.
// Computed from orders + the generated schedule only (no extra data source).
import { isWorkingDay } from "./time.js";

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
// Local calendar date (yyyy-mm-dd) — must match the local day used for capacity,
// so do NOT use toISOString() here (that shifts by the UTC offset).
const localDateStr = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/**
 * orderRiskScore(order, schedule) → number (higher = more at risk).
 *   completed → -1; overdue → 100 + days overdue; otherwise scaled by how close
 *   the due date is vs. how much of the order is planned/done.
 */
export function orderRiskScore(order, schedule = []) {
  if (order.status === "completed") return -1;
  if (!order.dueDate) return 0;
  const daysToDue = Math.floor((startOfDay(order.dueDate) - startOfDay(new Date())) / 86400000);
  const jobs = schedule.filter((j) => j.orderId === order.id);
  const planned = jobs.length > 0;
  const progress = jobs.length ? jobs.filter((j) => j.status === "completed").length / jobs.length : 0;

  if (daysToDue < 0) return 100 + Math.abs(daysToDue);
  if (daysToDue <= 1 && !planned) return 95;
  if (daysToDue <= 1 && progress < 0.5) return 90;
  if (daysToDue <= 2 && progress < 0.25) return 75;
  if (daysToDue <= 5 && !planned) return 60;
  if (daysToDue <= 5 && progress < 0.25) return 45;
  return Math.max(0, 30 - daysToDue);
}

export function riskLevel(score) {
  if (score >= 90) return "critical";
  if (score >= 60) return "warn";
  if (score >= 30) return "watch";
  return "ok";
}

/** Build a sorted watchlist of at-risk orders (excludes completed / no-risk). */
export function orderRiskWatchlist(orders = [], schedule = []) {
  return orders
    .map((o) => { const score = orderRiskScore(o, schedule); return { order: o, score, level: riskLevel(score) }; })
    .filter((r) => r.score >= 30)
    .sort((a, b) => b.score - a.score);
}

/**
 * machineLoadForecast(machineId, schedule, machine, days) → per-day load.
 * hrs = planned + changeover hours of jobs starting that day; pct vs shift capacity.
 */
export function machineLoadForecast(machineId, schedule, machine, days = 14, baseDate = new Date()) {
  const out = [];
  const base = startOfDay(baseDate);
  for (let i = 0; i < days; i++) {
    const day = new Date(base); day.setDate(base.getDate() + i);
    const hrs = (schedule || [])
      .filter((j) => j.machineId === machineId && startOfDay(j.startTime).getTime() === day.getTime())
      .reduce((s, j) => s + num(j.plannedHrs) + num(j.changeoverHrs), 0);
    const capacity = isWorkingDay(day, machine) ? num(machine?.shiftHrs, 8) : 0;
    out.push({ date: localDateStr(day), hrs: +hrs.toFixed(2), capacity, pct: capacity ? Math.round((hrs / capacity) * 100) : 0 });
  }
  return out;
}

/** Load heatmap for every machine over the window. */
export function loadHeatmap(machines = [], schedule = [], days = 14, baseDate = new Date()) {
  return machines.map((m) => ({ machine: m, days: machineLoadForecast(m.id, schedule, m, days, baseDate) }));
}

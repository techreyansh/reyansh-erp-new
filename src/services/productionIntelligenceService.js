import { supabase } from '../lib/supabaseClient';

/**
 * Production Intelligence — reads the captured production_hourly_log and turns
 * it into KPIs, trends and rule-based anomalies. Read-only over data the
 * Production Log already captures; no AI here (that's Phase 2).
 */

export async function getRows({ from, to, department } = {}) {
  let q = supabase.from('production_hourly_log').select('*');
  if (from) q = q.gte('log_date', from);
  if (to) q = q.lte('log_date', to);
  if (department && department !== 'all') q = q.eq('department', department);
  const { data, error } = await q.order('log_date', { ascending: true }).order('slot_index', { ascending: true });
  if (error) throw new Error('Load production data: ' + error.message);
  return data || [];
}

const pct = (a, t) => (t > 0 ? Math.round((a / t) * 1000) / 10 : 0);
const num = (x) => Number(x) || 0;

/** Compute the full dashboard payload from raw hourly rows (pure function). */
export function computeIntelligence(rows) {
  const totalTarget = rows.reduce((s, r) => s + num(r.target), 0);
  const totalAchieved = rows.reduce((s, r) => s + num(r.achieved), 0);
  const totalDowntime = rows.reduce((s, r) => s + num(r.downtime_minutes), 0);

  // trend by date
  const byDateMap = {};
  rows.forEach((r) => {
    const d = (byDateMap[r.log_date] = byDateMap[r.log_date] || { date: r.log_date, target: 0, achieved: 0, downtime: 0 });
    d.target += num(r.target); d.achieved += num(r.achieved); d.downtime += num(r.downtime_minutes);
  });
  const trendByDate = Object.values(byDateMap).sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, achievementPct: pct(d.achieved, d.target) }));

  // downtime by reason
  const reasonMap = {};
  rows.forEach((r) => {
    if (!r.reason || !num(r.downtime_minutes)) return;
    const k = (reasonMap[r.reason] = reasonMap[r.reason] || { reason: r.reason, minutes: 0, count: 0 });
    k.minutes += num(r.downtime_minutes); k.count += 1;
  });
  const downtimeByReason = Object.values(reasonMap).sort((a, b) => b.minutes - a.minutes);

  // per line × day
  const lineMap = {};
  rows.forEach((r) => {
    const k = `${r.log_date}|${r.department}|${r.line_no}`;
    const o = (lineMap[k] = lineMap[k] || { date: r.log_date, department: r.department, line: r.line_no, target: 0, achieved: 0, downtime: 0, slots: [] });
    o.target += num(r.target); o.achieved += num(r.achieved); o.downtime += num(r.downtime_minutes);
    o.slots.push({ slot: r.time_slot, ach: pct(num(r.achieved), num(r.target)), dt: num(r.downtime_minutes), reason: r.reason });
  });
  const lineDays = Object.values(lineMap).map((o) => ({ ...o, achievementPct: pct(o.achieved, o.target) }));

  // per line (rolled across days) for the ranking table
  const byLineMap = {};
  lineDays.forEach((o) => {
    const k = `${o.department}|${o.line}`;
    const b = (byLineMap[k] = byLineMap[k] || { department: o.department, line: o.line, target: 0, achieved: 0, downtime: 0 });
    b.target += o.target; b.achieved += o.achieved; b.downtime += o.downtime;
  });
  const byLine = Object.values(byLineMap).map((b) => ({ ...b, achievementPct: pct(b.achieved, b.target) }))
    .sort((a, b) => a.achievementPct - b.achievementPct);

  // ---- rule-based anomalies ----
  const anomalies = [];
  lineDays.forEach((o) => {
    if (o.achievementPct < 75) {
      anomalies.push({
        severity: o.achievementPct < 60 ? 'critical' : 'warning',
        title: `${o.line} hit ${o.achievementPct}% on ${o.date}`,
        detail: `Made ${o.achieved} of ${o.target} (${o.department}). ${o.downtime ? o.downtime + ' min downtime.' : ''}`.trim(),
        date: o.date, line: o.line, metric: o.achievementPct,
      });
    }
    // consecutive misses (>=2 slots below 70%)
    let run = 0, maxRun = 0;
    o.slots.forEach((s) => { run = s.ach < 70 ? run + 1 : 0; maxRun = Math.max(maxRun, run); });
    if (maxRun >= 3) {
      anomalies.push({ severity: 'warning', title: `${o.line}: ${maxRun} straight slots below 70% on ${o.date}`, detail: `${o.department}. Sustained dip — likely a single cause.`, date: o.date, line: o.line, metric: maxRun });
    }
  });
  // dominant downtime reason
  if (downtimeByReason[0] && downtimeByReason[0].minutes > 120) {
    const top = downtimeByReason[0];
    anomalies.push({ severity: 'info', title: `"${top.reason}" is the top downtime cause`, detail: `${top.minutes} min across ${top.count} slots in this period.`, metric: top.minutes });
  }
  const sevRank = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || (b.metric || 0) - (a.metric || 0));

  return {
    kpis: {
      totalTarget, totalAchieved, achievementPct: pct(totalAchieved, totalTarget),
      totalDowntime, topReason: downtimeByReason[0]?.reason || '—',
      days: trendByDate.length, lines: byLine.length,
    },
    trendByDate, downtimeByReason, byLine, anomalies,
  };
}

export async function getDashboard(opts) {
  const rows = await getRows(opts);
  return { rows: rows.length, ...computeIntelligence(rows) };
}

const productionIntelligenceService = { getRows, computeIntelligence, getDashboard };
export default productionIntelligenceService;

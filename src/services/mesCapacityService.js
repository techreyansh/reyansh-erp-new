import { supabase } from '../lib/supabaseClient';

/**
 * MES production board — computed from real data (open work orders, their
 * stages, and today's job-card entries). Deliberately does NOT fabricate
 * line-balance numbers from standard times that aren't captured yet; it shows
 * actual stage load + today's throughput/reject/downtime.
 */
function throwIf(error, ctx) { if (error) throw new Error(`${ctx ? ctx + ': ' : ''}${error.message}`); }
const num = (x) => Number(x) || 0;

/** Forked molding capacity (review fix): cavities x cycles/hr, not machine-hours. */
export function moldingCapacityPerHour(cavityCount, cycleTimeSec) {
  const cav = num(cavityCount) || 1; const cyc = num(cycleTimeSec);
  if (cyc <= 0) return 0;
  return Math.round(cav * (3600 / cyc));
}

export async function getDashboard() {
  const todayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const [woRes, stRes, logRes] = await Promise.all([
    supabase.from('ppc_wo').select('id, wo_number, qty, status, item:ppc_items(name)').in('status', ['planned', 'released', 'in_progress', 'qc']),
    supabase.from('ppc_wo_stage').select('id, work_order_id, stage_name, status, output_qty, scrap_qty').in('status', ['pending', 'running', 'blocked']),
    supabase.from('stage_execution_log').select('stage_id, output_qty, reject_qty, downtime_min, downtime_reason_id, logged_at, operator_name, work_order_id').gte('logged_at', todayIso),
  ]);
  throwIf(woRes.error, 'Load WOs'); throwIf(stRes.error, 'Load stages'); throwIf(logRes.error, 'Load log');
  const wos = woRes.data || [], stages = stRes.data || [], log = logRes.data || [];

  // KPIs
  const todayGood = log.reduce((s, l) => s + num(l.output_qty), 0);
  const todayReject = log.reduce((s, l) => s + num(l.reject_qty), 0);
  const todayDowntime = log.reduce((s, l) => s + num(l.downtime_min), 0);
  const rejectPct = todayGood + todayReject > 0 ? Math.round((todayReject / (todayGood + todayReject)) * 1000) / 10 : 0;
  const running = stages.filter((s) => s.status === 'running').length;

  // Stage load: open stages grouped by stage name (the "line balance" view over real WIP)
  const loadMap = {};
  stages.forEach((s) => {
    const o = (loadMap[s.stage_name] = loadMap[s.stage_name] || { stage: s.stage_name, open: 0, running: 0, pending: 0 });
    o.open++; o[s.status === 'running' ? 'running' : 'pending']++;
  });
  const stageLoad = Object.values(loadMap).sort((a, b) => b.open - a.open);

  // Today's output by stage (from the log, joined to stage name)
  const stageName = Object.fromEntries(stages.map((s) => [s.id, s.stage_name]));
  const outMap = {};
  log.forEach((l) => {
    const nm = stageName[l.stage_id] || 'Other';
    const o = (outMap[nm] = outMap[nm] || { stage: nm, good: 0, reject: 0 });
    o.good += num(l.output_qty); o.reject += num(l.reject_qty);
  });
  const outputByStage = Object.values(outMap).sort((a, b) => b.good - a.good);

  // Downtime by reason (needs the reason names)
  let downtimeByReason = [];
  const reasonIds = [...new Set(log.map((l) => l.downtime_reason_id).filter(Boolean))];
  if (reasonIds.length) {
    const { data: rs } = await supabase.from('downtime_reason').select('id, name').in('id', reasonIds);
    const rn = Object.fromEntries((rs || []).map((r) => [r.id, r.name]));
    const dmap = {};
    log.forEach((l) => { if (l.downtime_reason_id && num(l.downtime_min)) { const nm = rn[l.downtime_reason_id] || 'Other'; dmap[nm] = (dmap[nm] || 0) + num(l.downtime_min); } });
    downtimeByReason = Object.entries(dmap).map(([reason, minutes]) => ({ reason, minutes })).sort((a, b) => b.minutes - a.minutes);
  }

  const recent = [...log].sort((a, b) => b.logged_at.localeCompare(a.logged_at)).slice(0, 12)
    .map((l) => ({ ...l, stage: stageName[l.stage_id] || '—' }));

  return {
    kpis: { openWos: wos.length, running, todayGood, todayReject, rejectPct, todayDowntime },
    stageLoad, outputByStage, downtimeByReason, recent,
  };
}

const mesCapacityService = { moldingCapacityPerHour, getDashboard };
export default mesCapacityService;

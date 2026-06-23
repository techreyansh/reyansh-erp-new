// Rate Master + dynamic recosting (data layer). Editing a master rate logs the
// change and recosts every affected product costing via the pure recostEngine,
// so master rates flow through to product cost / price / margin automatically.
import { supabase } from '../lib/supabaseClient';
import { costAt, costImpact, isStale } from './recostEngine';

async function currentEmail() {
  try { return (await supabase.auth.getUser()).data?.user?.email || null; } catch { return null; }
}

export async function listRates() {
  const { data, error } = await supabase.from('material_rate').select('*').eq('is_active', true)
    .order('rate_type', { ascending: true }).order('material_code', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function rateMap() {
  const rates = await listRates();
  const m = {};
  rates.forEach((r) => { m[r.material_code] = Number(r.rate); });
  return m;
}

async function versionsWithLines(versionIds = null) {
  let vq = supabase.from('costing_version').select('*').neq('status', 'archived');
  if (versionIds) vq = vq.in('id', versionIds);
  const { data: versions } = await vq;
  const ids = (versions || []).map((v) => v.id);
  let lines = [];
  if (ids.length) { const { data } = await supabase.from('costing_line').select('*').in('costing_id', ids); lines = data || []; }
  const byV = {};
  lines.forEach((l) => { (byV[l.costing_id] ||= []).push(l); });
  return (versions || []).map((v) => ({ version: v, lines: byV[v.id] || [] }));
}

/** Recompute one version against current rates; write back line rates + version totals. */
export async function recostVersion(versionId, map = null) {
  const rmap = map || await rateMap();
  const items = await versionsWithLines([versionId]);
  if (!items.length) return null;
  const { version, lines } = items[0];
  const margin = Number(version.target_margin_pct) || Number(rmap.MARGIN_PCT) || 0;
  const { lines: priced, ...s } = costAt(lines, rmap, margin);
  for (const l of priced) {
    if (l.rate_overridden || l.id == null) continue;
    await supabase.from('costing_line').update({ rate: l.rate, amount: l.amount }).eq('id', l.id);
  }
  await supabase.from('costing_version').update({
    material_cost: s.material_cost, labour_cost: s.labour_cost, machine_cost: s.machine_cost,
    overhead_cost: s.overhead_cost, financial_cost: s.financial_cost, total_cost: s.total_cost,
    net_selling_price: s.net_selling_price, contribution_pct: s.contribution_pct,
    gross_margin_pct: s.gross_margin_pct, net_margin_pct: s.net_margin_pct,
    recosted_at: new Date().toISOString(), rate_basis_date: new Date().toISOString().slice(0, 10),
  }).eq('id', versionId);
  return s;
}

/** Versions with a non-frozen line referencing a rate code. */
export async function affectedVersions(code) {
  const { data } = await supabase.from('costing_line').select('costing_id')
    .eq('material_code', code).eq('rate_overridden', false);
  return [...new Set((data || []).map((l) => l.costing_id))];
}

export async function recostAffected(code, map = null) {
  const rmap = map || await rateMap();
  const ids = await affectedVersions(code);
  for (const id of ids) await recostVersion(id, rmap);
  return ids.length;
}

export async function recostAll() {
  const rmap = await rateMap();
  const items = await versionsWithLines();
  for (const { version } of items) await recostVersion(version.id, rmap);
  return items.length;
}

/** Apply a rate change: log it, then recost every affected product. */
export async function updateRate(code, newRate, reason = null) {
  const email = await currentEmail();
  const { data: existing } = await supabase.from('material_rate').select('rate, rate_type').eq('material_code', code).single();
  const old = Number(existing?.rate);
  const nw = Number(newRate);
  const { error } = await supabase.from('material_rate')
    .update({ previous_rate: old, rate: nw, updated_at: new Date().toISOString(), updated_by_email: email })
    .eq('material_code', code);
  if (error) throw error;
  const affected = await recostAffected(code);
  await supabase.from('rate_change_log').insert({
    rate_code: code, rate_type: existing?.rate_type, old_rate: old, new_rate: nw,
    pct_change: old ? +(((nw - old) / old) * 100).toFixed(2) : null,
    reason, changed_by_email: email, affected_versions: affected,
  });
  return { affected, old, new: nw };
}

/** What-if across all (or selected) versions — does NOT save. */
export async function whatIf(overrides, versionIds = null) {
  const rmap = await rateMap();
  const margin = Number(rmap.MARGIN_PCT) || 0;
  const items = await versionsWithLines(versionIds);
  return items.map(({ version, lines }) => ({
    version_id: version.id, costing_no: version.costing_no, product_name: version.product_name,
    ...costImpact(lines, rmap, overrides, Number(version.target_margin_pct) || margin),
  }));
}

/** Cost Control Dashboard rollup. */
export async function dashboard() {
  const [rates, items] = await Promise.all([listRates(), versionsWithLines()]);
  const rmap = {};
  rates.forEach((r) => { rmap[r.material_code] = Number(r.rate); });
  let stale = 0, belowTarget = 0;
  const alerts = [];
  items.forEach(({ version, lines }) => {
    if (isStale(version, lines, rmap)) stale += 1;
    if (Number(version.net_margin_pct) < Number(version.target_margin_pct)) {
      belowTarget += 1;
      alerts.push({ costing_no: version.costing_no, product_name: version.product_name,
        net_margin_pct: Number(version.net_margin_pct), target_margin_pct: Number(version.target_margin_pct) });
    }
  });
  const { data: log } = await supabase.from('rate_change_log').select('*').order('changed_at', { ascending: false }).limit(10);
  return { rates, totalProducts: items.length, stale, belowTarget, marginAlerts: alerts, recentChanges: log || [] };
}

const rateMasterService = {
  listRates, rateMap, recostVersion, affectedVersions, recostAffected, recostAll, updateRate, whatIf, dashboard,
};
export default rateMasterService;

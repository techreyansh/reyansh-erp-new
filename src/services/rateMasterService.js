// Rate Master + dynamic recosting (data layer). Editing a master rate logs the
// change and recosts every affected product costing via the pure recostEngine,
// so master rates flow through to product cost / price / margin automatically.
import { supabase } from '../lib/supabaseClient';
import { costImpact, isStale } from './recostEngine';

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

// Margin that drives a version's price: its own target if set (incl. 0), else the master default.
function versionMargin(version, rmap) {
  const tm = version?.target_margin_pct;
  return (tm == null || tm === '') ? (Number(rmap.MARGIN_PCT) || 0) : Number(tm);
}

async function versionsWithLines(versionIds = null) {
  // Exclude 'superseded' — those are intentionally frozen historical versions.
  let vq = supabase.from('costing_version').select('*').neq('status', 'superseded');
  if (versionIds) vq = vq.in('id', versionIds);
  const { data: versions } = await vq;
  const ids = (versions || []).map((v) => v.id);
  let lines = [];
  if (ids.length) { const { data } = await supabase.from('costing_line').select('*').in('costing_id', ids); lines = data || []; }
  const byV = {};
  lines.forEach((l) => { (byV[l.costing_id] ||= []).push(l); });
  return (versions || []).map((v) => ({ version: v, lines: byV[v.id] || [] }));
}

// Persisted recost is done by the DB function recost_costing_version (mirrors
// the JS engine exactly, validated). The JS engine is kept only for no-save
// preview/what-if (whatIf, isStale). One source of truth for applied numbers.

/** Recompute one version against current rates (delegates to the DB function). */
export async function recostVersion(versionId) {
  const { error } = await supabase.rpc('recost_costing_version', { p_version: versionId });
  if (error) throw error;
  return true;
}

/** Versions with a non-frozen line referencing a rate code. */
export async function affectedVersions(code) {
  const { data } = await supabase.from('costing_line').select('costing_id')
    .eq('material_code', code).eq('rate_overridden', false);
  return [...new Set((data || []).map((l) => l.costing_id))];
}

export async function recostAffected(code) {
  const ids = await affectedVersions(code);
  for (const id of ids) await recostVersion(id);
  return ids.length;
}

export async function recostAll() {
  const { data, error } = await supabase.rpc('recost_all_versions');
  if (error) throw error;
  return data || 0;
}

/**
 * Apply a rate change: the DB trigger on material_rate auto-recosts every
 * affected product and logs the change; here we just persist the rate, then
 * enrich the auto-log entry with the user's reason + actor.
 */
export async function updateRate(code, newRate, reason = null) {
  const email = await currentEmail();
  const { data: existing } = await supabase.from('material_rate').select('rate').eq('material_code', code).single();
  const old = Number(existing?.rate); const nw = Number(newRate);
  const { error } = await supabase.from('material_rate')
    .update({ previous_rate: old, rate: nw, updated_at: new Date().toISOString(), updated_by_email: email })
    .eq('material_code', code);
  if (error) throw error;
  // the trigger has now inserted a rate_change_log row + recosted products
  const { data: log } = await supabase.from('rate_change_log').select('id, affected_versions')
    .eq('rate_code', code).order('changed_at', { ascending: false }).limit(1);
  let affected = 0;
  if (log && log[0]) {
    affected = log[0].affected_versions || 0;
    const patch = { changed_by_email: email };
    if (reason) patch.reason = reason;
    await supabase.from('rate_change_log').update(patch).eq('id', log[0].id);
  }
  return { affected, old, new: nw };
}

/** What-if across all (or selected) versions — does NOT save. */
export async function whatIf(overrides, versionIds = null) {
  const rmap = await rateMap();
  const items = await versionsWithLines(versionIds);
  return items.map(({ version, lines }) => ({
    version_id: version.id, costing_no: version.costing_no, product_name: version.product_name,
    ...costImpact(lines, rmap, overrides, versionMargin(version, rmap)),
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

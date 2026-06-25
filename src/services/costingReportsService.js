// Costing reports — shapes Rate-Master / costing data into Report objects for
// ReportExportButton (PDF/Excel/CSV/Print). Each builder is async (fetches live).
import { supabase } from '../lib/supabaseClient';
import { rateMap } from './rateMasterService';
import { costAt } from './recostEngine';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (n) => `${Number(n || 0).toFixed(2)}%`;

async function activeVersions() {
  const { data } = await supabase.from('costing_version').select('*').neq('status', 'superseded').order('product_name');
  return data || [];
}

/** Per-product cost / price / margin / contribution. */
export async function profitabilityReport() {
  const rows = await activeVersions();
  return {
    key: 'profitability', title: 'Product Profitability', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [
      { label: 'Products', value: rows.length },
      { label: 'Avg net margin', value: pct(rows.reduce((s, r) => s + Number(r.net_margin_pct || 0), 0) / (rows.length || 1)) },
      { label: 'Below target', value: rows.filter((r) => Number(r.net_margin_pct) < Number(r.target_margin_pct)).length },
    ],
    sections: [{
      key: 'p', title: 'Profitability by product',
      columns: [{ key: 'product_name', label: 'Product' }, { key: 'total_cost', label: 'Cost' }, { key: 'net_selling_price', label: 'Price' }, { key: 'net_margin_pct', label: 'Net margin' }, { key: 'target_margin_pct', label: 'Target' }, { key: 'contribution_pct', label: 'Contribution' }],
      rows: rows.map((r) => ({ product_name: r.product_name, total_cost: inr(r.total_cost), net_selling_price: inr(r.net_selling_price), net_margin_pct: pct(r.net_margin_pct), target_margin_pct: pct(r.target_margin_pct), contribution_pct: pct(r.contribution_pct) })),
      emptyText: 'No product costings yet.',
    }],
  };
}

/** Audit of every master-rate change. */
export async function rateChangeReport() {
  const { data } = await supabase.from('rate_change_log').select('*').order('changed_at', { ascending: false });
  const rows = data || [];
  return {
    key: 'rate-changes', title: 'Rate Change Report', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Changes logged', value: rows.length }, { label: 'Rates affected', value: new Set(rows.map((r) => r.rate_code)).size }],
    sections: [{
      key: 'rc', title: 'Master rate changes',
      columns: [{ key: 'rate_code', label: 'Rate' }, { key: 'old_rate', label: 'Old' }, { key: 'new_rate', label: 'New' }, { key: 'pct_change', label: 'Δ%' }, { key: 'affected_versions', label: 'Products recosted' }, { key: 'changed_by_email', label: 'By' }, { key: 'changed_at', label: 'When' }],
      rows: rows.map((r) => ({ rate_code: r.rate_code, old_rate: r.old_rate, new_rate: r.new_rate, pct_change: r.pct_change != null ? pct(r.pct_change) : '—', affected_versions: r.affected_versions, changed_by_email: r.changed_by_email || '—', changed_at: new Date(r.changed_at).toLocaleString('en-IN') })),
      emptyText: 'No rate changes logged.',
    }],
  };
}

/** Products below their target margin. */
export async function marginImpactReport() {
  const rows = (await activeVersions()).filter((r) => Number(r.net_margin_pct) < Number(r.target_margin_pct));
  return {
    key: 'margin-impact', title: 'Margin Alert Report', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Below target', value: rows.length }],
    sections: [{
      key: 'm', title: 'Products below target margin',
      columns: [{ key: 'product_name', label: 'Product' }, { key: 'net_margin_pct', label: 'Net margin' }, { key: 'target_margin_pct', label: 'Target' }, { key: 'gap', label: 'Gap' }, { key: 'total_cost', label: 'Cost' }, { key: 'net_selling_price', label: 'Price' }],
      rows: rows.map((r) => ({ product_name: r.product_name, net_margin_pct: pct(r.net_margin_pct), target_margin_pct: pct(r.target_margin_pct), gap: pct(Number(r.net_margin_pct) - Number(r.target_margin_pct)), total_cost: inr(r.total_cost), net_selling_price: inr(r.net_selling_price) })),
      emptyText: 'All products meet target margin.',
    }],
  };
}

/**
 * Stale costings — products whose saved cost no longer matches a fresh recompute
 * at current rates (quotation-may-no-longer-be-profitable warning).
 */
export async function staleCostingReport() {
  const versions = await activeVersions();
  const ids = versions.map((v) => v.id);
  let lines = [];
  if (ids.length) { const { data } = await supabase.from('costing_line').select('*').in('costing_id', ids); lines = data || []; }
  const rmap = await rateMap();
  const byV = {};
  lines.forEach((l) => { (byV[l.costing_id] ||= []).push(l); });
  const today = Date.now();
  const rows = versions.map((v) => {
    const fresh = costAt(byV[v.id] || [], rmap, Number(v.target_margin_pct) || 0);
    const drift = +(fresh.total_cost - Number(v.total_cost || 0)).toFixed(2);
    const ageDays = v.recosted_at ? Math.round((today - new Date(v.recosted_at).getTime()) / 86400000) : null;
    return { ...v, fresh_cost: fresh.total_cost, fresh_price: fresh.net_selling_price, drift, ageDays, stale: Math.abs(drift) > 0.01 };
  }).filter((r) => r.stale).sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  return {
    key: 'stale', title: 'Stale Costing / Quotation Risk', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Stale costings', value: rows.length }],
    sections: [{
      key: 's', title: 'Costings out of date vs current rates',
      columns: [{ key: 'product_name', label: 'Product' }, { key: 'saved_cost', label: 'Saved cost' }, { key: 'fresh_cost', label: 'Cost @ current rates' }, { key: 'drift', label: 'Drift' }, { key: 'fresh_price', label: 'Reco. price' }, { key: 'age', label: 'Last recosted' }],
      rows: rows.map((r) => ({ product_name: r.product_name, saved_cost: inr(r.total_cost), fresh_cost: inr(r.fresh_cost), drift: `${r.drift > 0 ? '+' : ''}${inr(r.drift)}`, fresh_price: inr(r.fresh_price), age: r.ageDays != null ? `${r.ageDays}d ago` : '—' })),
      emptyText: 'All costings are current with master rates.',
    }],
  };
}

export const REPORTS = [
  { key: 'profitability', label: 'Product Profitability', build: profitabilityReport },
  { key: 'rate-changes', label: 'Rate Change History', build: rateChangeReport },
  { key: 'margin-impact', label: 'Margin Alerts', build: marginImpactReport },
  { key: 'stale', label: 'Stale Costings / Quote Risk', build: staleCostingReport },
];

const costingReportsService = { profitabilityReport, rateChangeReport, marginImpactReport, staleCostingReport, REPORTS };
export default costingReportsService;

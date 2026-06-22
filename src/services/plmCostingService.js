// Costing engine service (the folded-into-PLM costing tables, keyed on product).
// Versions, lines, central rates, recompute-persist, and the approval workflow.
import { supabase } from '../lib/supabaseClient';
import { recompute } from './costingEngine';

async function currentEmail() {
  try { return (await supabase.auth.getUser()).data?.user?.email || null; } catch { return null; }
}

// ---- material rates (central) ----
export async function listMaterialRates() {
  const { data } = await supabase.from('material_rate').select('*').order('material_code');
  return data || [];
}
export async function saveMaterialRate(rate) {
  const email = await currentEmail();
  const { data, error } = await supabase.from('material_rate')
    .insert({ ...rate, created_by_email: email }).select('*').single();
  if (error) throw error;
  return data;
}

export async function listTemplates() {
  const { data } = await supabase.from('costing_template').select('*').is('archived_at', null).order('name');
  return data || [];
}

// ---- costing versions ----
export async function listCostingsForProduct(productId) {
  const { data } = await supabase.from('costing_version').select('*')
    .eq('product_id', productId).order('version_number', { ascending: false });
  return data || [];
}

export async function getLatestReleased(productId) {
  const { data } = await supabase.from('costing_version').select('*')
    .eq('product_id', productId).eq('status', 'released')
    .order('version_number', { ascending: false }).limit(1);
  return (data && data[0]) || null;
}

export async function getCosting(id) {
  const { data: version, error } = await supabase.from('costing_version').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: lines } = await supabase.from('costing_line').select('*').eq('costing_id', id).order('sequence');
  return { version, lines: lines || [] };
}

export async function createCosting(productId, { product_name, customer_code, revision, template_id, mode = 'manual', target_margin_pct = 0 }) {
  const email = await currentEmail();
  const existing = await listCostingsForProduct(productId);
  const version_number = (existing[0]?.version_number || 0) + 1;
  const costing_no = `CST-${(product_name || 'PRD').replace(/\s+/g, '').slice(0, 12).toUpperCase()}-V${version_number}`;
  const { data, error } = await supabase.from('costing_version').insert({
    product_id: productId, product_name, customer_code, revision, template_id, mode,
    version_number, costing_no, status: 'draft', target_margin_pct, created_by_email: email,
  }).select('*').single();
  if (error) throw error;
  return data;
}

/** Replace a costing's lines and persist the recomputed summary. */
export async function saveCostingLines(costingId, lines, { targetMarginPct, qtyBasis } = {}) {
  await supabase.from('costing_line').delete().eq('costing_id', costingId);
  if (lines.length) {
    const rows = lines.map((l, i) => ({
      costing_id: costingId, section: l.section, category: l.category, material_code: l.material_code,
      qty: l.qty, uom: l.uom, rate: l.rate, rate_overridden: !!l.rate_overridden,
      amount: l.amount, is_percentage: !!l.is_percentage, pct_basis: l.pct_basis, sequence: i, notes: l.notes,
    }));
    const { error } = await supabase.from('costing_line').insert(rows);
    if (error) throw error;
  }
  const summary = recompute(lines, { targetMarginPct, qtyBasis });
  const { data, error } = await supabase.from('costing_version')
    .update({ ...summary, updated_at: new Date().toISOString() }).eq('id', costingId).select('*').single();
  if (error) throw error;
  return data;
}

const NEXT = { draft: 'reviewed', reviewed: 'approved', approved: 'released' };

/** Advance the approval workflow; releasing supersedes the prior released version. */
export async function transitionStatus(costingId, toStatus, reason) {
  const email = await currentEmail();
  const { data: cur } = await supabase.from('costing_version').select('*').eq('id', costingId).single();
  if (!cur) throw new Error('Costing not found.');
  const patch = { status: toStatus, updated_at: new Date().toISOString() };
  if (toStatus === 'approved') { patch.approved_by_email = email; patch.approved_at = new Date().toISOString(); }
  if (toStatus === 'reviewed') patch.reviewed_by_email = email;
  if (toStatus === 'released') {
    patch.released_at = new Date().toISOString();
    // supersede any other released version for the same product
    await supabase.from('costing_version').update({ status: 'superseded' })
      .eq('product_id', cur.product_id).eq('status', 'released').neq('id', costingId);
  }
  const { error } = await supabase.from('costing_version').update(patch).eq('id', costingId);
  if (error) throw error;
  await supabase.from('costing_status_log').insert({
    costing_id: costingId, from_status: cur.status, to_status: toStatus, changed_by_email: email, reason: reason || null,
  });
  return toStatus;
}

export const nextStatus = (s) => NEXT[s] || null;

const plmCostingService = {
  listMaterialRates, saveMaterialRate, listTemplates,
  listCostingsForProduct, getLatestReleased, getCosting, createCosting, saveCostingLines,
  transitionStatus, nextStatus,
};
export default plmCostingService;

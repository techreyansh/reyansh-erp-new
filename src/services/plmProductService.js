// PLM product master service — the single source of truth for "what we make"
// (the `product` table). Separate from the legacy productService.js (`products`
// table) which the old screen still uses until Phase 2 consolidation.
import { supabase } from '../lib/supabaseClient';

const PRODUCT_SELECT = '*';

async function currentEmail() {
  try { return (await supabase.auth.getUser()).data?.user?.email || null; } catch { return null; }
}

/** Ensure the product has a manufacturable item (ppc_items) for its BOM. Returns ppc_item_id. */
export async function ensureItem(productId) {
  const { data, error } = await supabase.rpc('product_ensure_item', { p_product_id: productId });
  if (error) throw new Error(error.message);
  return data;
}

export async function listProducts({ includeArchived = false } = {}) {
  let q = supabase.from('product').select(PRODUCT_SELECT).order('product_name', { ascending: true });
  if (!includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getProduct(id) {
  const { data, error } = await supabase.from('product').select(PRODUCT_SELECT).eq('id', id).single();
  if (error) throw error;
  return data;
}

async function nextProductCode() {
  const { data } = await supabase.from('product').select('product_code').ilike('product_code', 'PRD-%');
  let max = 0;
  (data || []).forEach((r) => { const n = parseInt(String(r.product_code).replace(/\D/g, ''), 10); if (n > max) max = n; });
  return `PRD-${String(max + 1).padStart(5, '0')}`;
}

export async function createProduct(payload) {
  const email = await currentEmail();
  const row = { ...payload, product_code: payload.product_code || (await nextProductCode()), created_by_email: email };
  const { data, error } = await supabase.from('product').insert(row).select(PRODUCT_SELECT).single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, patch) {
  const { data, error } = await supabase.from('product')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select(PRODUCT_SELECT).single();
  if (error) throw error;
  return data;
}

/** Duplicate a product (new code, copies spec/targets; not its costings). */
export async function duplicateProduct(id) {
  const src = await getProduct(id);
  const { id: _i, product_code: _c, created_at: _ca, updated_at: _ua, archived_at: _aa, ...rest } = src;
  return createProduct({ ...rest, product_name: `${src.product_name || 'Product'} (copy)`, status: 'development' });
}

export const archiveProduct = (id) => updateProduct(id, { archived_at: new Date().toISOString(), status: 'inactive' });
export const restoreProduct = (id) => updateProduct(id, { archived_at: null });
export const setProductStatus = (id, status) => updateProduct(id, { status });

/** Block delete if referenced anywhere. Returns {ok, blockers[]}. */
export async function checkDeletable(id) {
  const blockers = [];
  const probe = async (table, col, label) => {
    try {
      const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(col, id);
      if (count) blockers.push(`${label} (${count})`);
    } catch { /* table may not exist yet — ignore */ }
  };
  await probe('costing_version', 'product_id', 'Costings');
  await probe('sales_order_line', 'product_id', 'Sales order lines');
  return { ok: blockers.length === 0, blockers };
}

export async function deleteProduct(id) {
  const { ok, blockers } = await checkDeletable(id);
  if (!ok) throw new Error(`Cannot delete — referenced by: ${blockers.join(', ')}. Archive instead.`);
  const { error, count } = await supabase.from('product').delete({ count: 'exact' }).eq('id', id);
  if (error) throw error;
  if (!count) throw new Error('Delete was blocked (permission).');
}

// ---- revisions / process / documents ----
export async function listRevisions(productId) {
  const { data } = await supabase.from('product_revision').select('*').eq('product_id', productId).order('changed_at', { ascending: false });
  return data || [];
}
export async function addRevision(productId, { revision, change_reason, snapshot }) {
  const email = await currentEmail();
  const { error } = await supabase.from('product_revision').insert({ product_id: productId, revision, change_reason, snapshot, changed_by_email: email });
  if (error) throw error;
}
/** The product's currently-active routing version (null before any save/backfill). */
export async function getActiveRoutingVersion(productId) {
  const { data } = await supabase.from('routing_version').select('*')
    .eq('product_id', productId).eq('status', 'active')
    .order('effective_from', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return data || null;
}

/** Routing steps of the active version. Falls back to legacy unversioned rows
 *  (pre-backfill products) so the editor keeps working during the rollout. */
export async function listProcess(productId) {
  const ver = await getActiveRoutingVersion(productId);
  if (ver?.id) {
    const { data } = await supabase.from('product_process_step').select('*')
      .eq('routing_version_id', ver.id).order('sequence');
    return data || [];
  }
  const { data } = await supabase.from('product_process_step').select('*')
    .eq('product_id', productId).is('routing_version_id', null).order('sequence');
  return data || [];
}

/** Version-scoped save (atomic RPC): mints a new active version, supersedes the
 *  prior one, and preserves history. Replaces the old delete-all-then-insert
 *  that destroyed versioning (autoplan eng gate C1). */
export async function saveProcess(productId, steps) {
  const payload = (steps || []).map((s, i) => ({ ...s, sequence: i }));
  const { data, error } = await supabase.rpc('mes_save_routing', { p_product_id: productId, p_steps: payload });
  if (error) throw new Error(error.message);
  return data;
}

/** All routing versions for a product, newest first (for the history tab). */
export async function listRoutingVersions(productId) {
  const { data } = await supabase.from('routing_version').select('*')
    .eq('product_id', productId).order('version_number', { ascending: false });
  return data || [];
}

/** Steps belonging to a specific routing version (for the history diff view). */
export async function listProcessForVersion(versionId) {
  const { data } = await supabase.from('product_process_step').select('*')
    .eq('routing_version_id', versionId).order('sequence');
  return data || [];
}
export async function listProductDocuments(productId) {
  const { data } = await supabase.from('product_document').select('*').eq('product_id', productId).order('created_at', { ascending: false });
  return data || [];
}
export async function listSideConfig(productId) {
  const { data } = await supabase.from('assembly_side_config').select('*').eq('product_id', productId);
  return data || [];
}
export async function saveSideConfig(productId, side, fields) {
  const clean = { ...fields };
  ['cycle_time_sec'].forEach((k) => { if (clean[k] === '' || clean[k] == null) clean[k] = null; else clean[k] = Number(clean[k]); });
  const { data: existing } = await supabase.from('assembly_side_config').select('id').eq('product_id', productId).eq('side', side).maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from('assembly_side_config').update(clean).eq('id', existing.id); if (error) throw error;
  } else {
    const { error } = await supabase.from('assembly_side_config').insert({ product_id: productId, side, ...clean }); if (error) throw error;
  }
}
export async function listQualityPlan(productId) {
  const { data } = await supabase.from('product_quality_plan').select('*').eq('product_id', productId).order('sequence');
  return data || [];
}
export async function saveQualityPlan(productId, rows) {
  await supabase.from('product_quality_plan').delete().eq('product_id', productId);
  if (rows.length) {
    const insert = rows.map((r, i) => ({
      product_id: productId, sequence: i, stage: r.stage || 'in_process',
      characteristic: r.characteristic || null, specification: r.specification || null,
      method: r.method || null, frequency: r.frequency || null, sample_size: r.sample_size || null,
      reaction_plan: r.reaction_plan || null,
    }));
    const { error } = await supabase.from('product_quality_plan').insert(insert);
    if (error) throw error;
  }
}

const plmProductService = {
  listProducts, getProduct, createProduct, updateProduct, duplicateProduct,
  archiveProduct, restoreProduct, setProductStatus, checkDeletable, deleteProduct,
  listRevisions, addRevision, listProcess, saveProcess, listQualityPlan, saveQualityPlan,
  getActiveRoutingVersion, listRoutingVersions, listProcessForVersion,
  listSideConfig, saveSideConfig, listProductDocuments,
};
export default plmProductService;

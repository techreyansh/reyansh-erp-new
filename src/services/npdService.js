import { supabase } from '../lib/supabaseClient';

/**
 * NPD service — the app API for the New Product Development module. Projects
 * orchestrate existing modules (product / crm / costing / bom) by id; this
 * service never copies them. Stage moves go through the server-enforced
 * npd_move_stage RPC (ordinality + optimistic lock + history).
 */

/** Ordered stage model (must match npd_stage_order in the DB). */
export const NPD_STAGES = [
  { key: 'requirement_received', label: 'Requirement Received', group: 'Intake' },
  { key: 'technical_review', label: 'Technical Review', group: 'Intake' },
  { key: 'bom_ready', label: 'BOM Ready', group: 'Engineering' },
  { key: 'costing_ready', label: 'Costing Ready', group: 'Engineering' },
  { key: 'material_ready', label: 'Material Ready', group: 'Engineering' },
  { key: 'sample_development', label: 'Sample Under Development', group: 'Sampling' },
  { key: 'testing', label: 'Testing', group: 'Sampling' },
  { key: 'sample_dispatch', label: 'Sample Dispatch', group: 'Sampling' },
  { key: 'customer_feedback', label: 'Customer Feedback', group: 'Approval' },
  { key: 'approved', label: 'Approved', group: 'Approval' },
  { key: 'production_release', label: 'Production Release', group: 'Approval' },
];
export const NPD_STAGE_LABEL = Object.fromEntries(NPD_STAGES.map((s) => [s.key, s.label]));

function throwIf(error, ctx) {
  if (error) throw new Error(`${ctx ? ctx + ': ' : ''}${error.message}`);
}

/** All projects (RLS-open; the app gates the /npd module). */
export async function listProjects() {
  const { data, error } = await supabase
    .from('npd_project')
    .select('*')
    .order('created_at', { ascending: false });
  throwIf(error, 'List NPD projects');
  return data || [];
}

export async function getProject(id) {
  const { data, error } = await supabase.from('npd_project').select('*').eq('id', id).single();
  throwIf(error, 'Get NPD project');
  return data;
}

/** All developments for one CRM customer (by code or account id). */
export async function listByCustomer({ customerCode, accountId } = {}) {
  let q = supabase.from('npd_project').select('*');
  if (accountId && customerCode) q = q.or(`account_id.eq.${accountId},customer_code.eq.${customerCode}`);
  else if (accountId) q = q.eq('account_id', accountId);
  else if (customerCode) q = q.eq('customer_code', customerCode);
  else return [];
  const { data, error } = await q.order('created_at', { ascending: false });
  throwIf(error, 'List customer developments');
  return data || [];
}

/**
 * Create a development (race-safe project_no minted server-side). Columns the
 * RPC doesn't take (development_type / opportunity / account_id) are patched
 * straight after.
 */
export async function createProject(payload) {
  // `notes` is a real npd_project column but the create RPC doesn't take it, so
  // (like development_type/opportunity/account_id) it's patched straight after.
  const { development_type, opportunity, account_id, notes, ...core } = payload || {};
  const { data, error } = await supabase.rpc('npd_create_project', { p_payload: core });
  throwIf(error, 'Create NPD project');
  const extra = {};
  if (development_type) extra.development_type = development_type;
  if (opportunity) extra.opportunity = opportunity;
  if (account_id) extra.account_id = account_id;
  if (notes && notes.trim()) extra.notes = notes.trim();
  if (data?.id && Object.keys(extra).length) {
    try { return await updateProject(data.id, extra); } catch { /* non-fatal */ }
  }
  return data;
}

/** Patch simple fields (owner, target date, parts, etc.). */
export async function updateProject(id, patch) {
  const { data, error } = await supabase.from('npd_project').update(patch).eq('id', id).select('*').single();
  throwIf(error, 'Update NPD project');
  return data;
}

/**
 * Move a project's stage. Returns { ok, conflict?, blocked?, message?, stage? }.
 * Pass expectedFrom (the stage the UI saw) for the optimistic-lock check, and
 * force=true to skip a gate with a logged reason.
 */
export async function moveStage(id, toStage, { expectedFrom = null, note = null, force = false } = {}) {
  const { data, error } = await supabase.rpc('npd_move_stage', {
    p_id: id, p_to_stage: toStage, p_expected_from: expectedFrom, p_note: note, p_force: force,
  });
  throwIf(error, 'Move stage');
  return data;
}

export async function getStageHistory(id) {
  const { data, error } = await supabase
    .from('npd_stage_history')
    .select('*')
    .eq('project_id', id)
    .order('id', { ascending: false });
  throwIf(error, 'Stage history');
  return data || [];
}

export async function listDocuments(id) {
  const { data, error } = await supabase
    .from('npd_document')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false });
  throwIf(error, 'List documents');
  return data || [];
}

/** Upload a file to the shared `documents` bucket under npd/<project>/ + index it.
 *  Supersedes any current doc in the same category (version control). */
export async function uploadDocument(projectId, file, { docType = 'other', category = 'other' } = {}) {
  const path = `npd/${projectId}/${Date.now()}_${file.name}`;
  const up = await supabase.storage.from('documents').upload(path, file, { upsert: true });
  throwIf(up.error, 'Upload file');
  // version: next version within this project+category; mark prior current ones stale
  const { data: prior } = await supabase.from('npd_document').select('version')
    .eq('project_id', projectId).eq('category', category).order('version', { ascending: false }).limit(1);
  const version = ((prior && prior[0]?.version) || 0) + 1;
  if (version > 1) {
    await supabase.from('npd_document').update({ is_current: false })
      .eq('project_id', projectId).eq('category', category);
  }
  const { data, error } = await supabase
    .from('npd_document')
    .insert({ project_id: projectId, doc_type: docType, category, file_name: file.name, storage_path: path, version, is_current: true })
    .select('*')
    .single();
  throwIf(error, 'Index document');
  return data;
}

// ---- P6 — sample dispatch tracking ----
export async function listDispatches(projectId) {
  const { data, error } = await supabase.from('npd_dispatch').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  throwIf(error, 'List dispatches'); return data || [];
}
export async function addDispatch(projectId, payload) {
  const { data, error } = await supabase.from('npd_dispatch').insert({ project_id: projectId, ...payload }).select('*').single();
  throwIf(error, 'Add dispatch'); return data;
}
export async function updateDispatch(id, patch) {
  const { data, error } = await supabase.from('npd_dispatch').update(patch).eq('id', id).select('*').single();
  throwIf(error, 'Update dispatch'); return data;
}

export async function documentUrl(storagePath) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, 3600);
  throwIf(error, 'Document URL');
  return data?.signedUrl;
}

// ---- Phase 3 — samples, quality, customer feedback, production release ----
export async function listSamples(projectId) {
  const { data, error } = await supabase.from('npd_sample').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  throwIf(error, 'List samples'); return data || [];
}
export async function addSample(projectId, payload) {
  const { data, error } = await supabase.from('npd_sample').insert({ project_id: projectId, ...payload }).select('*').single();
  throwIf(error, 'Add sample'); return data;
}
export async function updateSample(id, patch) {
  const { data, error } = await supabase.from('npd_sample').update(patch).eq('id', id).select('*').single();
  throwIf(error, 'Update sample'); return data;
}
export async function listQualityChecks(projectId) {
  const { data, error } = await supabase.from('npd_quality_check').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  throwIf(error, 'List quality checks'); return data || [];
}
export async function addQualityCheck(projectId, payload) {
  const { data, error } = await supabase.from('npd_quality_check').insert({ project_id: projectId, ...payload }).select('*').single();
  throwIf(error, 'Add quality check'); return data;
}
export async function listFeedback(projectId) {
  const { data, error } = await supabase.from('npd_feedback').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  throwIf(error, 'List feedback'); return data || [];
}
export async function addFeedback(projectId, payload) {
  const { data, error } = await supabase.from('npd_feedback').insert({ project_id: projectId, ...payload }).select('*').single();
  throwIf(error, 'Add feedback'); return data;
}
export async function releaseToProduction(projectId) {
  const { data, error } = await supabase.rpc('npd_release_to_production', { p_project_id: projectId });
  throwIf(error, 'Release to production'); return data;
}

const npdService = {
  NPD_STAGES, NPD_STAGE_LABEL,
  listProjects, listByCustomer, getProject, createProject, updateProject,
  moveStage, getStageHistory, listDocuments, uploadDocument, documentUrl,
  listSamples, addSample, updateSample, listQualityChecks, addQualityCheck,
  listFeedback, addFeedback, releaseToProduction,
  listDispatches, addDispatch, updateDispatch,
};
export default npdService;

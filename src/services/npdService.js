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

/** Create a project (race-safe project_no minted server-side). */
export async function createProject(payload) {
  const { data, error } = await supabase.rpc('npd_create_project', { p_payload: payload });
  throwIf(error, 'Create NPD project');
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

/** Upload a file to the shared `documents` bucket under npd/<project>/ + index it. */
export async function uploadDocument(projectId, file, { docType = 'other' } = {}) {
  const path = `npd/${projectId}/${Date.now()}_${file.name}`;
  const up = await supabase.storage.from('documents').upload(path, file, { upsert: true });
  throwIf(up.error, 'Upload file');
  const { data, error } = await supabase
    .from('npd_document')
    .insert({ project_id: projectId, doc_type: docType, file_name: file.name, storage_path: path })
    .select('*')
    .single();
  throwIf(error, 'Index document');
  return data;
}

export async function documentUrl(storagePath) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, 3600);
  throwIf(error, 'Document URL');
  return data?.signedUrl;
}

const npdService = {
  NPD_STAGES, NPD_STAGE_LABEL,
  listProjects, getProject, createProject, updateProject,
  moveStage, getStageHistory, listDocuments, uploadDocument, documentUrl,
};
export default npdService;

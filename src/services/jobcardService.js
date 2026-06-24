import { supabase } from '../lib/supabaseClient';

/**
 * Job-card capture — the MES adoption loop. Operators post actual / reject /
 * downtime against a live ppc_wo_stage. Entries are append-only
 * (stage_execution_log); the stage's totals roll up server-side.
 */

function throwIf(error, ctx) { if (error) throw new Error(`${ctx ? ctx + ': ' : ''}${error.message}`); }

/** Open work orders + their stages, for the floor picker. */
export async function listOpenWorkOrders() {
  const { data, error } = await supabase
    .from('ppc_wo')
    .select('id, wo_number, qty, status, due_date, item:ppc_items(code, name)')
    .in('status', ['planned', 'released', 'in_progress', 'qc'])
    .order('created_at', { ascending: false });
  throwIf(error, 'Load work orders');
  return data || [];
}

export async function listStages(workOrderId) {
  const { data, error } = await supabase
    .from('ppc_wo_stage')
    .select('*')
    .eq('work_order_id', workOrderId)
    .order('sequence');
  throwIf(error, 'Load stages');
  return data || [];
}

export async function listReasons() {
  const { data, error } = await supabase.from('downtime_reason').select('*').eq('is_active', true).order('name');
  throwIf(error, 'Load downtime reasons');
  return data || [];
}

export async function listDefects() {
  const { data, error } = await supabase.from('defect_code').select('*').eq('is_active', true).order('name');
  throwIf(error, 'Load defect codes');
  return data || [];
}

export async function listStageLog(stageId) {
  const { data, error } = await supabase
    .from('stage_execution_log')
    .select('*')
    .eq('stage_id', stageId)
    .order('logged_at', { ascending: false })
    .limit(20);
  throwIf(error, 'Load entries');
  return data || [];
}

/** Post a job-card entry. Returns { ok, output_total, reject_total, downtime_total }. */
export async function postJobcard({ stageId, output, reject = 0, downtime = 0, downtimeReason = null, defect = null, operator = null, machine = null, note = null }) {
  const { data, error } = await supabase.rpc('ppc_post_jobcard', {
    p_stage_id: stageId, p_output: Number(output) || 0, p_reject: Number(reject) || 0,
    p_downtime: Number(downtime) || 0, p_downtime_reason: downtimeReason, p_defect: defect,
    p_operator: operator, p_machine: machine, p_note: note,
  });
  throwIf(error, 'Post job card');
  return data;
}

const jobcardService = { listOpenWorkOrders, listStages, listReasons, listDefects, listStageLog, postJobcard };
export default jobcardService;

// Order-to-Dispatch Workflow Engine — client service (thin).
//
// The engine's authority lives in Postgres (wf_* tables + the SECURITY DEFINER
// RPCs wf_create_instance / wf_reconcile / wf_link_wo). This service only READS
// the spine for UI and calls those RPCs as the WRITE side. It never re-implements
// orchestration logic.
import { supabase } from '../lib/supabaseClient';

/** The workflow instance for a sales order (or null if none yet). */
export async function getInstanceBySo(soId) {
  if (!soId) return null;
  const { data, error } = await supabase
    .from('wf_instance').select('*').eq('sales_order_id', soId).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Full per-order workflow view: { instance, stages[], events[] }. */
export async function getWorkflow(soId) {
  const instance = await getInstanceBySo(soId);
  if (!instance) return { instance: null, stages: [], events: [] };
  const [{ data: stages }, { data: events }] = await Promise.all([
    supabase.from('wf_stage_run').select('*').eq('instance_id', instance.id).order('sequence'),
    supabase.from('wf_event').select('*').eq('instance_id', instance.id)
      .order('created_at', { ascending: false }).limit(200),
  ]);
  return { instance, stages: stages || [], events: events || [] };
}

/** Idempotently create (or fetch) the workflow for a released sales order. */
export async function createInstance(soId, orderType = null) {
  const { data, error } = await supabase.rpc('wf_create_instance', {
    p_so: soId, p_order_type: orderType,
  });
  if (error) throw error;
  return data; // instance id
}

/** Drive the engine: settle one instance (or all active when omitted). */
export async function reconcile(instanceId = null) {
  const { data, error } = await supabase.rpc('wf_reconcile', { p_instance: instanceId });
  if (error) throw error;
  return data; // number of changes applied
}

/**
 * Record that a work order belongs to a stage (the correlation that closes the
 * order-blind gap), then settle the instance. Call this right after the existing
 * MES screen mints the WO (mes_release_plan_to_floor / cable_create_work_order).
 */
export async function linkWorkOrder(stageRunId, woId, {
  linkKind = 'ppc', demandId = null, planId = null, instanceId = null,
} = {}) {
  const { error } = await supabase.rpc('wf_link_wo', {
    p_stage_run_id: stageRunId, p_wo_id: woId,
    p_link_kind: linkKind, p_demand_id: demandId, p_plan_id: planId,
  });
  if (error) throw error;
  return reconcile(instanceId);
}

/**
 * Mark a stage's human task complete (for 'manual' stages — e.g. production
 * planning / closure), then settle the instance so the next stage unblocks.
 */
export async function completeStageTask(taskId, instanceId = null) {
  if (taskId) {
    const { error } = await supabase.rpc('update_my_task_status', {
      p_task_id: taskId, p_status: 'completed',
    });
    if (error) {
      // Fallback: direct update (RLS allows the assignee).
      const { error: e2 } = await supabase
        .from('tasks').update({ task_status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', taskId);
      if (e2) throw e2;
    }
  }
  return reconcile(instanceId);
}

const workflowEngineService = {
  getInstanceBySo, getWorkflow, createInstance, reconcile, linkWorkOrder, completeStageTask,
};
export default workflowEngineService;

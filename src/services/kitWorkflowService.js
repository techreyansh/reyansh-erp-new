// KIT workflow automation — enrollment + step execution (data layer).
// Pure logic lives in kitWorkflowEngine; this module persists it to Supabase.
import { supabase } from '../lib/supabaseClient';
import { advance, autoEnrollPlan, dueEnrollments, currentStep } from './kitWorkflowEngine';
import * as kitService from './kitService';

const today = () => new Date().toISOString().slice(0, 10);

export async function listEnrollments(filters = {}) {
  let q = supabase.from('kit_workflow_enrollment').select('*').order('next_due_date', { ascending: true, nullsFirst: false });
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.workflowId) q = q.eq('workflow_id', filters.workflowId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function enroll(workflow, contact) {
  const firstWait = (workflow.steps || [])[0]?.wait_days || 0;
  const row = {
    workflow_id: workflow.id, account_id: contact.account_id, company_name: contact.company_name,
    status: 'active', current_step: 0,
    next_due_date: new Date(Date.now()).toISOString().slice(0, 10), // first step due now (+0); engine handles >0 via advance
    owner_email: contact.owner_email || null,
  };
  if (firstWait > 0) { const d = new Date(); d.setDate(d.getDate() + firstWait); row.next_due_date = d.toISOString().slice(0, 10); }
  const { data, error } = await supabase.from('kit_workflow_enrollment')
    .upsert(row, { onConflict: 'workflow_id,account_id' }).select().single();
  if (error) throw error;
  return data;
}

/** Mark the current step done and move the enrollment forward (or complete it). */
export async function advanceStep(enrollment, workflow) {
  const patch = { ...advance(enrollment, workflow, today()), last_action_at: new Date().toISOString() };
  const { data, error } = await supabase.from('kit_workflow_enrollment')
    .update(patch).eq('id', enrollment.id).select().single();
  if (error) throw error;
  return data;
}

export async function cancelEnrollment(id) {
  const { error } = await supabase.from('kit_workflow_enrollment')
    .update({ status: 'cancelled', last_action_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Scan contacts against every active workflow's trigger and enroll new matches. */
export async function autoEnroll() {
  const [workflows, contacts, existing] = await Promise.all([
    kitService.listWorkflows(), kitService.listContacts(), listEnrollments(),
  ]);
  const active = (workflows || []).filter((w) => w.is_active && (w.steps || []).length);
  let plan = [];
  for (const w of active) plan = plan.concat(autoEnrollPlan(contacts || [], w, existing, today()));
  if (!plan.length) return { enrolled: 0 };
  const { error } = await supabase.from('kit_workflow_enrollment')
    .upsert(plan, { onConflict: 'workflow_id,account_id', ignoreDuplicates: true });
  if (error) throw error;
  return { enrolled: plan.length };
}

/** Enrollments whose current step is due now, joined with their workflow + step + contact. */
export async function dueSteps() {
  const [enrollments, workflows, contacts] = await Promise.all([
    listEnrollments({ status: 'active' }), kitService.listWorkflows(), kitService.listContacts(),
  ]);
  const wfById = Object.fromEntries((workflows || []).map((w) => [w.id, w]));
  const cById = Object.fromEntries((contacts || []).map((c) => [c.account_id, c]));
  return dueEnrollments(enrollments, today()).map((e) => {
    const wf = wfById[e.workflow_id];
    return { enrollment: e, workflow: wf, step: currentStep(e, wf), contact: cById[e.account_id] || null };
  }).filter((d) => d.workflow && d.step);
}

export const kitWorkflowService = { listEnrollments, enroll, advanceStep, cancelEnrollment, autoEnroll, dueSteps };
export default kitWorkflowService;

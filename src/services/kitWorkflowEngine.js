// KIT workflow automation engine (pure). A workflow is a trigger + ordered
// steps [{channel, category, wait_days}]. Contacts get enrolled; the engine
// computes which step is DUE and how to advance. No network.

export function addDays(dateStr, n) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + (Number(n) || 0));
  return d.toISOString().slice(0, 10);
}

export function currentStep(enrollment, workflow) {
  const steps = workflow?.steps || [];
  const i = enrollment?.current_step ?? 0;
  return steps[i] || null;
}

/** Advance to the next step. Returns the enrollment patch (completed when no steps left). */
export function advance(enrollment, workflow, today = new Date().toISOString().slice(0, 10)) {
  const steps = workflow?.steps || [];
  const nextIdx = (enrollment?.current_step ?? 0) + 1;
  if (nextIdx >= steps.length) {
    return { current_step: nextIdx, status: 'completed', next_due_date: null, completed_at: today };
  }
  return { current_step: nextIdx, status: 'active', next_due_date: addDays(today, steps[nextIdx].wait_days) };
}

export function isDue(enrollment, today = new Date().toISOString().slice(0, 10)) {
  return enrollment?.status === 'active' && !!enrollment.next_due_date && enrollment.next_due_date <= today;
}

/** Active enrollments whose current step is due, newest-due first. */
export function dueEnrollments(enrollments = [], today = new Date().toISOString().slice(0, 10)) {
  return enrollments.filter((e) => isDue(e, today))
    .sort((a, b) => String(a.next_due_date).localeCompare(String(b.next_due_date)));
}

/** Does a contact match a workflow's trigger? (uses v_kit_contacts signals) */
export function matchTrigger(contact, workflow) {
  if (!contact || !workflow?.is_active) return false;
  const cfg = workflow.trigger_config || {};
  const days = Number(contact.days_since_touch);
  const stage = String(contact.prospect_stage || contact.client_stage || '').toLowerCase();
  switch (workflow.trigger_type) {
    case 'no_interaction_30d': return Number.isFinite(days) && days >= (Number(cfg.days) || 30);
    case 'no_order_90d': return Number.isFinite(days) && days >= (Number(cfg.days) || 90);
    case 'new_prospect': return contact.account_type === 'prospect' && (!Number.isFinite(days) || days <= (Number(cfg.days) || 2));
    case 'quotation_sent': return /quotation/.test(stage);
    case 'manual': return false;
    default: return false;
  }
}

/** Build new enrollments for contacts that match a workflow and aren't already enrolled in it. */
export function autoEnrollPlan(contacts = [], workflow, existingEnrollments = [], today = new Date().toISOString().slice(0, 10)) {
  const enrolled = new Set(existingEnrollments.filter((e) => e.workflow_id === workflow.id).map((e) => e.account_id));
  const firstWait = (workflow.steps || [])[0]?.wait_days || 0;
  return contacts.filter((c) => !enrolled.has(c.account_id) && matchTrigger(c, workflow)).map((c) => ({
    workflow_id: workflow.id, account_id: c.account_id, company_name: c.company_name,
    status: 'active', current_step: 0, next_due_date: addDays(today, firstWait), owner_email: c.owner_email || null,
  }));
}

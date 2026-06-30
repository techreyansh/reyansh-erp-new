// Shared labels/helpers for the Order-to-Dispatch workflow UI.
// Used by the timeline stage rail, the activity feed, and the department workboard.

// wf_stage_run.status -> MUI color
export const STATUS_COLOR = {
  blocked: 'default', ready: 'info', in_progress: 'warning',
  done: 'success', skipped: 'default', cancelled: 'error',
};

// wf_instance.status -> MUI color
export const INSTANCE_COLOR = { active: 'warning', blocked: 'error', completed: 'success', cancelled: 'default' };

// A stage is human-actionable (shows a "Complete" affordance) only when the
// engine waits on a person rather than a system signal.
export function isManualStage(stage) {
  return (stage?.watch_signal || 'manual') === 'manual';
}

// For sensor stages, what real-world event the engine is waiting on.
export function waitingOn(stage) {
  switch (stage?.watch_signal) {
    case 'kit_issued': return 'Waiting on store / inventory';
    case 'wo_status_done':
    case 'wo_status_qc': return 'Waiting on production';
    case 'fg_stocked': return 'Waiting on finished goods';
    case 'dispatch_status': return 'Waiting on dispatch';
    case 'so_status': return 'Waiting on sales';
    default: return null; // manual -> actionable, no wait label
  }
}

// Overdue = past its engine due date and not finished.
export function isOverdue(stage) {
  if (!stage?.due_date) return false;
  if (['done', 'skipped', 'cancelled'].includes(stage.status)) return false;
  const due = new Date(stage.due_date); due.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return due < today;
}

// Predecessor stages (for this instance's order_type) that aren't done yet —
// i.e. why a blocked stage can't start. Returns an array of stage labels.
export function stageBlockers(stage, stagesByKey, deps, orderType) {
  if (!stage || stage.status !== 'blocked') return [];
  return (deps || [])
    .filter((d) => d.stage_key === stage.stage_key && (d.order_type === 'ALL' || d.order_type === orderType))
    .map((d) => stagesByKey[d.depends_on])
    .filter((pred) => pred && !['done', 'skipped'].includes(pred.status))
    .map((pred) => pred.label || pred.stage_key);
}

// Activity-feed event kind -> color (hex, matching the Client360 timeline style).
export const KIND_COLOR = {
  workflow: '#455a64',   // engine stage events
  order: '#7b1fa2',      // sales_order status changes
  production: '#ed6c02', // ppc_wo status changes
  audit: '#607d8b',
};

export const KIND_LABEL = { workflow: 'Workflow', order: 'Order', production: 'Production', audit: 'Audit' };

// Dispatch backward-planning engine (pure, no network). The dispatch date drives
// the whole schedule: each stage's completion date = working backwards from
// dispatch through the manufacturing chain. Also computes dispatch readiness.

// Default reverse chain (each stage's lead = working days BEFORE the next stage,
// from the user's spec). Editable per product later via product_process_step.
export const DISPATCH_STAGES = [
  { key: 'packing', label: 'Packing', lead_days: 1, dept: 'Dispatch' },
  { key: 'inspection', label: 'Visual Inspection', lead_days: 1, dept: 'Quality' },
  { key: 'testing', label: 'Testing', lead_days: 1, dept: 'Quality' },
  { key: 'moulding', label: 'Moulding', lead_days: 2, dept: 'Production' },
  { key: 'assembly', label: 'Assembly', lead_days: 2, dept: 'Production' },
  { key: 'cable', label: 'Cable Ready', lead_days: 2, dept: 'Production' },
  { key: 'material', label: 'Material Required', lead_days: 3, dept: 'Store' },
  { key: 'purchase', label: 'Purchase Required', lead_days: 3, dept: 'Purchase' },
];

const isSunday = (d) => d.getDay() === 0;

/** Subtract `n` working days (skip Sundays) from a date. */
export function subtractWorkingDays(date, n) {
  const d = new Date(date);
  let left = Math.max(0, Math.round(n));
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    if (!isSunday(d)) left -= 1;
  }
  return d;
}

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Backward schedule from a dispatch date.
 * @returns [{ key, label, dept, due_date }] in chain order (packing → purchase).
 */
export function backwardPlan(dispatchDate, stages = DISPATCH_STAGES) {
  if (!dispatchDate) return [];
  let cursor = new Date(dispatchDate);
  if (Number.isNaN(cursor.getTime())) return [];
  return stages.map((s) => {
    cursor = subtractWorkingDays(cursor, s.lead_days);
    return { key: s.key, label: s.label, dept: s.dept, due_date: iso(cursor) };
  });
}

/** Total working-day lead time from purchase-start to dispatch. */
export function totalLeadDays(stages = DISPATCH_STAGES) {
  return stages.reduce((a, s) => a + s.lead_days, 0);
}

/**
 * Dispatch readiness from per-department progress (0–100).
 * @param progress { material, cable, assembly, quality, packing } (0–100)
 * @returns { overall, bands: [{key,label,pct,band}] } band = green|yellow|red
 */
export function readiness(progress = {}) {
  const dims = [
    { key: 'material', label: 'Material' },
    { key: 'cable', label: 'Cable' },
    { key: 'assembly', label: 'Assembly' },
    { key: 'quality', label: 'Quality' },
    { key: 'packing', label: 'Packing' },
  ];
  const bands = dims.map((d) => {
    const pct = Math.max(0, Math.min(100, Number(progress[d.key]) || 0));
    return { ...d, pct, band: pct >= 90 ? 'green' : pct >= 50 ? 'yellow' : 'red' };
  });
  const overall = Math.round(bands.reduce((a, b) => a + b.pct, 0) / bands.length);
  return { overall, band: overall >= 90 ? 'green' : overall >= 50 ? 'yellow' : 'red', bands };
}

/** Risk: is any backward-stage due date already in the past vs today? */
export function planRisk(plan, today = new Date()) {
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  const overdue = plan.filter((s) => new Date(s.due_date) < t);
  return { atRisk: overdue.length > 0, overdueStages: overdue.map((s) => s.label) };
}

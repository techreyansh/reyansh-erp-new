// Production tracking analytics (Cable Production Planning — Phase 4).
// Pure aggregations over ppc_wo rows (work-order level) — no DB, no React, so it
// unit-tests cleanly. The per-order stage workflow lives in the UI (getWorkOrder).

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// Normalise the assorted ppc_wo status strings into stable buckets.
export function woStatusBucket(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("done") || s.includes("complete") || s.includes("closed")) return "completed";
  if (s.includes("progress") || s.includes("running") || s.includes("wip")) return "running";
  if (s.includes("plan") || s.includes("release") || s.includes("schedule")) return "planned";
  return "open";
}

export function woProgress(wo) {
  const q = num(wo.qty);
  if (q <= 0) return 0;
  return Math.max(0, Math.min(1, num(wo.produced_qty) / q));
}

/**
 * workOrderDashboard(workOrders, baseDate, opts) → counts by bucket, totals,
 * overall progress, plus prioritised at-risk and overdue lists. at-risk =
 * active (not completed/cancelled) AND (overdue OR due within dueSoonDays with
 * progress below progressFloor).
 */
export function workOrderDashboard(workOrders = [], baseDate = new Date(), opts = {}) {
  const { dueSoonDays = 3, progressFloor = 0.5 } = opts;
  const today = startOfDay(baseDate);
  const counts = { open: 0, planned: 0, running: 0, completed: 0, cancelled: 0 };
  let plannedQty = 0, producedQty = 0, scrapQty = 0;
  const atRisk = [], overdue = [];

  for (const wo of workOrders) {
    const bucket = woStatusBucket(wo.status);
    counts[bucket] += 1;
    plannedQty += num(wo.qty);
    producedQty += num(wo.produced_qty);
    scrapQty += num(wo.scrap_qty);

    const active = bucket !== "completed" && bucket !== "cancelled";
    if (!active) continue;
    const progress = woProgress(wo);
    const due = wo.due_date ? startOfDay(wo.due_date) : null;
    const daysToDue = due ? Math.round((due - today) / 86400000) : null;
    const isOverdue = daysToDue != null && daysToDue < 0;
    const dueSoon = daysToDue != null && daysToDue >= 0 && daysToDue <= dueSoonDays;

    if (isOverdue) overdue.push({ wo, daysOverdue: Math.abs(daysToDue), progress });
    if (isOverdue || (dueSoon && progress < progressFloor)) {
      const riskScore = isOverdue ? 100 + Math.abs(daysToDue) : 70 - daysToDue * 10 + (1 - progress) * 20;
      atRisk.push({ wo, daysToDue, progress, overdue: isOverdue, riskScore: Math.round(riskScore) });
    }
  }

  atRisk.sort((a, b) => b.riskScore - a.riskScore);
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
  const active = counts.open + counts.planned + counts.running;
  const total = active + counts.completed + counts.cancelled;

  return {
    counts, total, active,
    plannedQty: +plannedQty.toFixed(1),
    producedQty: +producedQty.toFixed(1),
    scrapQty: +scrapQty.toFixed(1),
    overallProgress: plannedQty > 0 ? Math.round((producedQty / plannedQty) * 100) : 0,
    scrapRate: producedQty + scrapQty > 0 ? +((scrapQty / (producedQty + scrapQty)) * 100).toFixed(1) : 0,
    atRisk,
    overdue,
  };
}

// Report builders for the operations modules (Sales Orders, Dispatch,
// Production Demand). Each returns a Report object for reportEngine.exportReport.
import { backwardPlan, readiness } from '../dispatchPlanner';

const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const cap = (s) => String(s || '').replace(/_/g, ' ');

export function buildSalesOrderReport(orders = []) {
  const open = orders.filter((o) => !['cancelled', 'closed'].includes(o.status));
  return {
    key: 'sales-order-register',
    title: 'Sales Order Register',
    subtitle: 'Reyansh International',
    generatedAt: new Date(),
    kpis: [
      { label: 'Total Orders', value: orders.length },
      { label: 'Open Orders', value: open.length },
      { label: 'Open Value', value: inr(open.reduce((a, o) => a + (Number(o.total_value) || 0), 0)) },
      { label: 'Released+', value: orders.filter((o) => !['draft', 'pending_review', 'approved', 'cancelled'].includes(o.status)).length },
    ],
    sections: [{
      key: 'orders', title: 'Sales Orders',
      columns: [
        { key: 'so_number', label: 'SO #' }, { key: 'company_name', label: 'Customer' },
        { key: 'po_number', label: 'PO' }, { key: 'created', label: 'Date' },
        { key: 'total_qty', label: 'Qty' }, { key: 'value', label: 'Value' },
        { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' },
      ],
      rows: orders.map((o) => ({
        so_number: o.so_number, company_name: o.company_name, po_number: o.po_number || '',
        created: fmtD(o.created_at), total_qty: o.total_qty, value: inr(o.total_value),
        priority: cap(o.priority), status: cap(o.status),
      })),
      emptyText: 'No sales orders.',
    }],
  };
}

export function buildDispatchReport(plans = []) {
  const active = plans.filter((p) => !['dispatched', 'cancelled'].includes(p.status));
  return {
    key: 'dispatch-plan',
    title: 'Dispatch Plan Report',
    subtitle: 'Reyansh International',
    generatedAt: new Date(),
    kpis: [
      { label: 'Active Plans', value: active.length },
      { label: 'Ready', value: plans.filter((p) => p.status === 'ready').length },
      { label: 'Open Value', value: inr(active.reduce((a, p) => a + (Number(p.total_value) || 0), 0)) },
    ],
    sections: [{
      key: 'plans', title: 'Dispatch Plans',
      columns: [
        { key: 'company_name', label: 'Customer' }, { key: 'so_number', label: 'SO #' },
        { key: 'dispatch_date', label: 'Dispatch' }, { key: 'purchase_by', label: 'Purchase by' },
        { key: 'readiness', label: 'Readiness' }, { key: 'qty', label: 'Qty' },
        { key: 'value', label: 'Value' }, { key: 'status', label: 'Status' },
      ],
      rows: plans.map((p) => {
        const sched = backwardPlan(p.dispatch_date);
        const purchase = sched.find((s) => s.key === 'purchase');
        return {
          company_name: p.company_name, so_number: p.so_number, dispatch_date: fmtD(p.dispatch_date),
          purchase_by: purchase ? fmtD(purchase.due_date) : '', readiness: `${readiness(p.readiness || {}).overall}%`,
          qty: p.total_qty, value: inr(p.total_value), status: cap(p.status),
        };
      }),
      emptyText: 'No dispatch plans.',
    }],
  };
}

export function buildProductionDemandReport(rows = []) {
  return {
    key: 'production-demand',
    title: 'Production Demand Report',
    subtitle: 'Reyansh International',
    generatedAt: new Date(),
    kpis: [
      { label: 'Demand Lines', value: rows.length },
      { label: 'Pending', value: rows.filter((r) => r.status === 'pending').length },
      { label: 'Open Units', value: rows.filter((r) => !['done', 'cancelled'].includes(r.status)).reduce((a, r) => a + (Number(r.qty) || 0), 0) },
    ],
    sections: [{
      key: 'demand', title: 'Production Demand',
      columns: [
        { key: 'product_name', label: 'Product' }, { key: 'company_name', label: 'Customer' },
        { key: 'so_number', label: 'SO #' }, { key: 'qty', label: 'Qty' },
        { key: 'required', label: 'Required' }, { key: 'status', label: 'Status' },
      ],
      rows: rows.map((r) => ({
        product_name: r.product_name, company_name: r.company_name, so_number: r.so_number,
        qty: `${r.qty} ${r.uom || ''}`, required: fmtD(r.required_date), status: cap(r.status),
      })),
      emptyText: 'No production demand.',
    }],
  };
}

export function buildNpdReport(data = {}, range = {}) {
  const k = data.kpis || {};
  return {
    key: 'npd-intelligence',
    title: 'NPD Intelligence',
    subtitle: 'Reyansh International — New Product Development',
    generatedAt: new Date(),
    dateRange: range.from ? { label: `${range.from} → ${range.to}`, from: range.from, to: range.to } : undefined,
    kpis: [
      { label: 'Active', value: k.active ?? 0 },
      { label: 'Approved (range)', value: k.approved_in_range ?? 0 },
      { label: 'Delayed', value: k.delayed ?? 0 },
      { label: 'Awaiting feedback', value: k.awaiting_feedback ?? 0 },
      { label: 'Overdue feedback', value: k.overdue_feedback ?? 0 },
      { label: 'Avg turnaround', value: k.avg_turnaround_days == null ? '—' : `${k.avg_turnaround_days} d` },
      { label: 'Approval rate', value: k.approval_rate == null ? '—' : `${k.approval_rate}%` },
      { label: 'Sample pass rate', value: k.sample_pass_rate == null ? '—' : `${k.sample_pass_rate}%` },
    ],
    sections: [
      {
        key: 'funnel', title: 'Pipeline by stage (active)',
        columns: [{ key: 'stage', label: 'Stage' }, { key: 'count', label: 'Projects' }],
        rows: (data.funnel || []).map((d) => ({ stage: cap(d.stage), count: d.count })),
        emptyText: 'No active projects.',
      },
      {
        key: 'aging', title: 'Average days in stage',
        columns: [{ key: 'stage', label: 'Stage' }, { key: 'avg_days', label: 'Avg days' }],
        rows: (data.stage_aging || []).map((d) => ({ stage: cap(d.stage), avg_days: d.avg_days })),
        emptyText: 'No stage history.',
      },
      {
        key: 'outcomes', title: 'Feedback outcomes',
        columns: [{ key: 'outcome', label: 'Outcome' }, { key: 'count', label: 'Count' }],
        rows: (data.outcome_mix || []).map((d) => ({ outcome: cap(d.outcome), count: d.count })),
        emptyText: 'No feedback recorded.',
      },
      {
        key: 'engineers', title: 'Active load by engineer',
        columns: [{ key: 'engineer', label: 'Engineer' }, { key: 'count', label: 'Active' }],
        rows: (data.by_engineer || []).map((d) => ({ engineer: d.engineer, count: d.count })),
        emptyText: 'No active projects.',
      },
      {
        key: 'delayed', title: 'Delayed developments',
        columns: [
          { key: 'project_no', label: 'Project' }, { key: 'product', label: 'Product' },
          { key: 'customer', label: 'Customer' }, { key: 'stage', label: 'Stage' },
          { key: 'engineer', label: 'Engineer' }, { key: 'target_date', label: 'Target' },
          { key: 'days_overdue', label: 'Overdue (d)' },
        ],
        rows: (data.delayed_list || []).map((p) => ({
          project_no: p.project_no, product: p.product, customer: p.customer,
          stage: cap(p.stage), engineer: p.engineer || '', target_date: p.target_date, days_overdue: p.days_overdue,
        })),
        emptyText: 'Nothing past target.',
      },
    ],
  };
}

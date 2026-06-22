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

// Operations Control Tower — one command view over the order-to-cash backbone.
// summarizeOperations is pure (testable); fetchOperations wires it to Supabase
// and folds in MRP shortfall + un-invoiced signals.
import { supabase } from '../lib/supabaseClient';
import mrpService from './mrpService';
import invoiceService from './invoiceService';

const num = (v) => Number(v) || 0;
// Backlog = work still to fulfil — excludes draft and anything dispatched/closed.
const OPEN_ORDER = (s) => !['draft', 'cancelled', 'completed', 'delivered', 'dispatched'].includes(s);

// Raw SO status → funnel stage.
const STAGE_OF = {
  draft: 'Draft', released: 'Confirmed', confirmed: 'Confirmed', in_planning: 'Confirmed',
  in_production: 'In Production', ready_to_dispatch: 'Ready', partially_dispatched: 'Ready',
  dispatched: 'Fulfilled', completed: 'Fulfilled', delivered: 'Fulfilled',
};
const FUNNEL_ORDER = ['Draft', 'Confirmed', 'In Production', 'Ready', 'Fulfilled'];

/**
 * @param o { orders, dispatches, demands, invoices, today, mrpShortCount, uninvoicedCount, uninvoicedValue }
 */
export function summarizeOperations(o = {}) {
  const today = o.today || new Date().toISOString().slice(0, 10);
  const orders = o.orders || [], dispatches = o.dispatches || [], demands = o.demands || [], invoices = o.invoices || [];

  // Funnel by stage
  const stage = {};
  FUNNEL_ORDER.forEach((s) => { stage[s] = { key: s, label: s, count: 0, value: 0 }; });
  let cancelled = 0;
  orders.forEach((r) => {
    if (r.status === 'cancelled') { cancelled += 1; return; }
    const s = STAGE_OF[r.status] || 'Confirmed';
    if (!stage[s]) stage[s] = { key: s, label: s, count: 0, value: 0 };
    stage[s].count += 1; stage[s].value += num(r.total_value);
  });
  const funnel = FUNNEL_ORDER.map((s) => stage[s]);

  // Money flow
  const liveInvoices = invoices.filter((i) => i.status !== 'CANCELLED'); // finance_invoices uses uppercase status
  const orderBacklogValue = orders.filter((r) => OPEN_ORDER(r.status)).reduce((s, r) => s + num(r.total_value), 0);
  const invoicedValue = liveInvoices.reduce((s, i) => s + num(i.amount), 0);
  const outstandingValue = liveInvoices.reduce((s, i) => s + num(i.balance), 0);
  const collectedValue = invoicedValue - outstandingValue;

  // Attention rail
  const attention = [];
  const overdueDispatch = dispatches.filter((d) => d.dispatch_date && d.dispatch_date < today && !d.actual_dispatch_date && !['dispatched', 'delivered', 'cancelled', 'completed'].includes(d.status));
  if (overdueDispatch.length) attention.push({ severity: 'high', code: 'dispatch_overdue', label: 'Dispatches overdue', detail: `${overdueDispatch.length} past planned date`, count: overdueDispatch.length, link: '/dispatch-control' });

  const overdueAR = liveInvoices.filter((i) => num(i.balance) > 0 && i.due_date && i.due_date < today);
  if (overdueAR.length) attention.push({ severity: 'high', code: 'ar_overdue', label: 'Payments overdue', detail: `₹${overdueAR.reduce((s, i) => s + num(i.balance), 0).toLocaleString('en-IN')} across ${overdueAR.length}`, count: overdueAR.length, link: '/crm/collections' });

  const prodBehind = demands.filter((d) => d.required_date && d.required_date < today && !['done', 'completed', 'cancelled'].includes(d.status));
  if (prodBehind.length) attention.push({ severity: 'med', code: 'prod_behind', label: 'Production behind schedule', detail: `${prodBehind.length} demand(s) past required date`, count: prodBehind.length, link: '/production-demand' });

  if (num(o.mrpShortCount) > 0) attention.push({ severity: 'med', code: 'mrp_short', label: 'Material shortfalls', detail: `${o.mrpShortCount} material(s) short of stock`, count: o.mrpShortCount, link: '/mrp' });

  if (num(o.uninvoicedCount) > 0) attention.push({ severity: 'med', code: 'uninvoiced', label: 'Orders ready to invoice', detail: `${o.uninvoicedCount} un-invoiced${o.uninvoicedValue ? ` · ₹${num(o.uninvoicedValue).toLocaleString('en-IN')}` : ''}`, count: o.uninvoicedCount, link: '/invoicing' });

  const SEV = { high: 0, med: 1, low: 2 };
  attention.sort((a, b) => SEV[a.severity] - SEV[b.severity]);

  return {
    funnel, cancelled,
    money: {
      orderBacklogValue: +orderBacklogValue.toFixed(2), invoicedValue: +invoicedValue.toFixed(2),
      collectedValue: +collectedValue.toFixed(2), outstandingValue: +outstandingValue.toFixed(2),
    },
    counts: {
      openOrders: orders.filter((r) => OPEN_ORDER(r.status)).length,
      openDemands: demands.filter((d) => !['done', 'completed', 'cancelled'].includes(d.status)).length,
      upcomingDispatches: dispatches.filter((d) => !['dispatched', 'delivered', 'cancelled', 'completed'].includes(d.status)).length,
      openInvoices: liveInvoices.filter((i) => num(i.balance) > 0).length,
    },
    attention,
  };
}

export async function fetchOperations() {
  const today = new Date().toISOString().slice(0, 10);
  const [orders, dispatches, demands, invoices, mrp, eligible] = await Promise.all([
    supabase.from('sales_order').select('status, total_value').then((r) => r.data || []),
    supabase.from('dispatch_plan').select('dispatch_date, actual_dispatch_date, status').then((r) => r.data || []),
    supabase.from('production_demand').select('status, required_date').then((r) => r.data || []),
    supabase.from('finance_invoices').select('amount, balance, due_date, status').then((r) => r.data || []),
    mrpService.computeMrp().catch(() => ({ shortCount: 0 })),
    invoiceService.listEligibleOrders().catch(() => []),
  ]);
  const uninv = eligible.filter((o) => !o.invoiced_number);
  return summarizeOperations({
    orders, dispatches, demands, invoices, today,
    mrpShortCount: mrp.shortCount || 0,
    uninvoicedCount: uninv.length,
    uninvoicedValue: uninv.reduce((s, o) => s + num(o.total_value), 0),
  });
}

const operationsControlService = { summarizeOperations, fetchOperations };
export default operationsControlService;

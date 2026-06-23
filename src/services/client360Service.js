// Client-360 data layer (A Phase 2). Pulls a single client's full operational
// picture by customer_code / account_id across CRM + ERP. Each fetch is
// defensive (returns [] on error) so one missing module never breaks the view.
import { supabase } from '../lib/supabaseClient';

const safe = (q) => q.then((r) => r.data || []).catch(() => []);
const num = (v) => Number(v) || 0;

/**
 * @param account { id (crm_pipeline uuid), customer_code, company_name }
 * @returns full 360 bundle.
 */
export async function getClient360(account = {}) {
  const code = account.customer_code || null;
  const id = account.id || null;

  const [products, orders, invoices, dispatches, complaints, quotations, orderCycles, prodDemand, kit, healthAll] = await Promise.all([
    code ? safe(supabase.from('product').select('product_code, product_name, status, current_revision').eq('customer_code', code)) : [],
    code ? safe(supabase.from('sales_order').select('id, so_number, status, total_qty, total_value, po_number, expected_dispatch_date, created_at').eq('customer_code', code).order('created_at', { ascending: false })) : [],
    code ? safe(supabase.from('finance_invoices').select('invoice_number, invoice_date, amount, balance, status, due_date').eq('customer_code', code).order('invoice_date', { ascending: false })) : [],
    code ? safe(supabase.from('dispatch_plan').select('so_number, dispatch_date, actual_dispatch_date, status, total_value').eq('customer_code', code).order('dispatch_date', { ascending: false })) : [],
    code ? safe(supabase.from('crm_complaints').select('subject, severity, status, created_at, resolved_at').eq('customer_code', code).order('created_at', { ascending: false })) : [],
    id ? safe(supabase.from('crm_quotations').select('quote_number, quote_date, valid_until, status, total').eq('account_id', id).order('quote_date', { ascending: false })) : [],
    code ? safe(supabase.from('crm_order_cycle').select('order_number, cycle_stage, amount, order_date, stage_entered_at').eq('customer_code', code).order('order_date', { ascending: false })) : [],
    code ? safe(supabase.from('production_demand').select('so_number, product_name, qty, uom, status, required_date').eq('customer_code', code)) : [],
    id ? safe(supabase.from('kit_messages').select('channel, direction, subject, status, sent_at, created_at').eq('account_id', id).order('created_at', { ascending: false }).limit(50)) : [],
    safe(supabase.rpc('crm_client_health')),
  ]);

  const health = (Array.isArray(healthAll) ? healthAll : []).find(
    (h) => String(h.customer_code || '').toLowerCase() === String(code || '').toLowerCase(),
  ) || null;

  const outstanding = invoices.reduce((s, i) => s + num(i.balance), 0);
  const billed = invoices.reduce((s, i) => s + num(i.amount), 0);
  const openOrders = orders.filter((o) => !['completed', 'cancelled', 'dispatched', 'delivered'].includes(o.status)).length;
  const openComplaints = complaints.filter((c) => !['resolved', 'closed'].includes(String(c.status || '').toLowerCase())).length;

  return {
    products, orders, invoices, dispatches, complaints, quotations, orderCycles, prodDemand, kit, health,
    summary: { outstanding, billed, openOrders, openComplaints, totalOrders: orders.length },
  };
}

const client360Service = { getClient360 };
export default client360Service;

// Invoicing — generate GST tax invoices from sales orders into finance_invoices
// (the same table the AR/Collections screen reads), plus a line-item layer.
import { supabase } from '../lib/supabaseClient';
import { computeInvoice, isInterState } from './gstEngine';
import { SELLER, DEFAULT_GST_RATE } from '../config/company';

async function currentEmail() {
  try { return (await supabase.auth.getUser()).data?.user?.email || null; } catch { return null; }
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function nextInvoiceNumber() {
  const d = new Date();
  const prefix = `INV-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const { data } = await supabase.from('finance_invoices').select('invoice_number').ilike('invoice_number', `${prefix}-%`);
  let max = 0;
  (data || []).forEach((r) => { const n = parseInt(String(r.invoice_number).split('-').pop(), 10); if (n > max) max = n; });
  return `${prefix}-${pad(max + 1, 3)}`;
}

/** Sales orders that can be invoiced (released+), with an invoiced flag. */
export async function listEligibleOrders() {
  const { data: orders } = await supabase.from('sales_order')
    .select('id, so_number, customer_code, company_name, po_number, total_value, status, payment_terms')
    .not('status', 'in', '(draft,cancelled)').order('created_at', { ascending: false });
  const ids = (orders || []).map((o) => o.id);
  let invoicedBy = {};
  if (ids.length) {
    const { data: inv } = await supabase.from('finance_invoices').select('sales_order_id, invoice_number').in('sales_order_id', ids);
    (inv || []).forEach((r) => { invoicedBy[r.sales_order_id] = r.invoice_number; });
  }
  return (orders || []).map((o) => ({ ...o, invoiced_number: invoicedBy[o.id] || null }));
}

async function findCustomer(code, name) {
  if (code) {
    const { data } = await supabase.from('clients2').select('*').or(`ClientCode.eq.${code},AccountCode.eq.${code}`).limit(1);
    if (data && data[0]) return data[0];
  }
  if (name) {
    const { data } = await supabase.from('clients2').select('*').eq('ClientName', name).limit(1);
    if (data && data[0]) return data[0];
  }
  return null;
}

/**
 * Create a GST tax invoice from a sales order.
 * @param soId
 * @param opts { gstRate, interState (bool|undefined=auto), invoiceDate, termsDays, hsn }
 */
export async function createFromSalesOrder(soId, opts = {}) {
  const { data: so, error: soErr } = await supabase.from('sales_order').select('*').eq('id', soId).single();
  if (soErr) throw soErr;
  const { data: soLines } = await supabase.from('sales_order_line')
    .select('product_code, product_name, qty, uom, unit_price').eq('so_id', soId).order('sequence', { ascending: true });
  if (!soLines || !soLines.length) throw new Error('Sales order has no line items to invoice.');

  const customer = await findCustomer(so.customer_code, so.company_name);
  const interState = opts.interState != null ? !!opts.interState : isInterState(SELLER.stateCode, customer?.StateCode);
  const gstRate = opts.gstRate != null ? Number(opts.gstRate) : DEFAULT_GST_RATE;

  const raw = soLines.map((l) => ({
    product_code: l.product_code, product_name: l.product_name, hsn: opts.hsn || null,
    qty: l.qty, uom: l.uom, rate: l.unit_price, gst_rate: gstRate,
  }));
  const calc = computeInvoice(raw, { gstRate, interState });

  const invoiceDate = opts.invoiceDate || ymd(new Date());
  const termsDays = opts.termsDays != null ? Number(opts.termsDays) : 30;
  const due = new Date(invoiceDate); due.setDate(due.getDate() + termsDays);
  const email = await currentEmail();
  const invoice_number = await nextInvoiceNumber();

  const header = {
    sales_order_id: soId, invoice_number, invoice_date: invoiceDate, status: 'issued',
    customer_code: so.customer_code, customer_name: so.company_name,
    amount: calc.grandTotal, balance: calc.grandTotal, amount_received: 0,
    payment_terms_days: termsDays, due_date: ymd(due), po_ref: so.po_number, owner_email: so.owner_email || email,
    taxable_value: calc.taxable, gst_rate: gstRate, cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst,
    round_off: calc.roundOff, inter_state: interState,
    place_of_supply: customer?.State || null, customer_gstin: customer?.GSTIN || null, seller_gstin: SELLER.gstin || null,
  };
  const { data: inv, error } = await supabase.from('finance_invoices').insert(header).select().single();
  if (error) throw error;
  const { error: lerr } = await supabase.from('finance_invoice_line').insert(calc.lines.map((l) => ({ ...l, invoice_id: inv.id })));
  if (lerr) throw lerr;
  return inv;
}

export async function listInvoices() {
  const { data, error } = await supabase.from('finance_invoices').select('*').order('invoice_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getInvoice(id) {
  const [{ data: inv, error }, { data: lines }] = await Promise.all([
    supabase.from('finance_invoices').select('*').eq('id', id).single(),
    supabase.from('finance_invoice_line').select('*').eq('invoice_id', id).order('sequence', { ascending: true }),
  ]);
  if (error) throw error;
  return { ...inv, lines: lines || [], seller: SELLER };
}

export async function cancelInvoice(id) {
  const { error } = await supabase.from('finance_invoices').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw error;
}

const invoiceService = { listEligibleOrders, createFromSalesOrder, listInvoices, getInvoice, cancelInvoice };
export default invoiceService;

// Sales Order service — the Order Initiation Engine. Header + product-master
// line items (with released-costing prices) + documents + the status machine.
import { supabase } from '../lib/supabaseClient';

async function currentEmail() {
  try { return (await supabase.auth.getUser()).data?.user?.email || null; } catch { return null; }
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

async function nextSoNumber() {
  const d = new Date();
  const prefix = `SO-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const { data } = await supabase.from('sales_order').select('so_number').ilike('so_number', `${prefix}-%`);
  let max = 0;
  (data || []).forEach((r) => { const n = parseInt(String(r.so_number).split('-').pop(), 10); if (n > max) max = n; });
  return `${prefix}-${pad(max + 1, 3)}`;
}

export async function listSalesOrders() {
  const { data, error } = await supabase.from('sales_order').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getSalesOrder(id) {
  const { data: order, error } = await supabase.from('sales_order').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: lines } = await supabase.from('sales_order_line').select('*').eq('so_id', id).order('sequence');
  const { data: documents } = await supabase.from('sales_order_document').select('*').eq('so_id', id).order('created_at', { ascending: false });
  const { data: history } = await supabase.from('sales_order_status_log').select('*').eq('so_id', id).order('changed_at', { ascending: false });
  return { order, lines: lines || [], documents: documents || [], history: history || [] };
}

const STATUS_FLOW = {
  draft: 'pending_review', pending_review: 'approved', approved: 'released',
  released: 'in_planning', in_planning: 'in_production', in_production: 'partially_dispatched',
  partially_dispatched: 'dispatched', dispatched: 'closed',
};
export const nextStatus = (s) => STATUS_FLOW[s] || null;

/** Create the order header + lines in one shot. lines: [{product_id, ...}]. */
export async function createOrder({ header, lines = [], status = 'draft' }) {
  const email = await currentEmail();
  const so_number = await nextSoNumber();
  const total_qty = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const total_value = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
  const { data: order, error } = await supabase.from('sales_order').insert({
    ...header, so_number, status, total_qty, total_value,
    created_by_email: email, owner_email: header.owner_email || email,
    released_at: status === 'released' ? new Date().toISOString() : null,
  }).select('*').single();
  if (error) throw error;

  if (lines.length) {
    const rows = lines.map((l, i) => ({
      so_id: order.id, product_id: l.product_id, product_code: l.product_code, product_name: l.product_name,
      customer_part_no: l.customer_part_no, revision: l.revision, qty: Number(l.qty) || 0, uom: l.uom || 'pc',
      unit_price: Number(l.unit_price) || 0, line_value: (Number(l.qty) || 0) * (Number(l.unit_price) || 0),
      costing_version_id: l.costing_version_id || null, required_delivery_date: l.required_delivery_date || null,
      remarks: l.remarks, sequence: i,
    }));
    const { error: lErr } = await supabase.from('sales_order_line').insert(rows);
    if (lErr) throw lErr;
  }
  await supabase.from('sales_order_status_log').insert({ so_id: order.id, from_status: null, to_status: status, changed_by_email: email });
  return order;
}

export async function uploadOrderDocument(orderId, file, docType = 'po') {
  if (!file) return null;
  const path = `sales_orders/${orderId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const { error } = await supabase.storage.from('documents').upload(path, file);
  if (error) throw error;
  const email = await currentEmail();
  await supabase.from('sales_order_document').insert({ so_id: orderId, doc_type: docType, file_name: file.name, storage_path: path, uploaded_by_email: email });
  return path;
}

export async function transitionStatus(orderId, toStatus, note) {
  const email = await currentEmail();
  const { data: cur } = await supabase.from('sales_order').select('status').eq('id', orderId).single();
  const patch = { status: toStatus, updated_at: new Date().toISOString() };
  if (toStatus === 'released') patch.released_at = new Date().toISOString();
  const { error } = await supabase.from('sales_order').update(patch).eq('id', orderId);
  if (error) throw error;
  await supabase.from('sales_order_status_log').insert({ so_id: orderId, from_status: cur?.status, to_status: toStatus, changed_by_email: email, note: note || null });
  return toStatus;
}

const salesOrderService = { listSalesOrders, getSalesOrder, createOrder, uploadOrderDocument, transitionStatus, nextStatus };
export default salesOrderService;

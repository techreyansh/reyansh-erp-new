// Purchase Requisition — demand-driven request raised from MRP shortfalls.
// Pure buildPrLines (testable) + a thin Supabase persistence/workflow layer.
import { supabase } from '../lib/supabaseClient';

async function currentEmail() {
  try { return (await supabase.auth.getUser()).data?.user?.email || null; } catch { return null; }
}
const pad = (n, w = 2) => String(n).padStart(w, '0');

async function nextPrNumber() {
  const d = new Date();
  const prefix = `PR-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const { data } = await supabase.from('purchase_requisition').select('pr_number').ilike('pr_number', `${prefix}-%`);
  let max = 0;
  (data || []).forEach((r) => { const n = parseInt(String(r.pr_number).split('-').pop(), 10); if (n > max) max = n; });
  return `${prefix}-${pad(max + 1, 3)}`;
}

/**
 * Pure: turn netted MRP materials into PR lines. Only materials that need
 * buying (status short/unmatched, shortfall > 0). order_qty defaults to the
 * shortfall; est_amount = order_qty × est_rate (rate optional, by code).
 * @param materials [{ code, name, uom, qty, onHand, shortfall, status, stockItem }]
 * @param rateByCode { CODE: rate }
 */
export function buildPrLines(materials = [], rateByCode = {}) {
  return materials
    .filter((m) => (m.status === 'short' || m.status === 'unmatched') && Number(m.shortfall) > 0)
    .map((m, i) => {
      const orderQty = +Number(m.shortfall).toFixed(3);
      const estRate = Number(rateByCode[m.code]) || 0;
      return {
        material_code: m.code || null,
        material_name: m.name || null,
        uom: m.uom || null,
        required_qty: +Number(m.qty || 0).toFixed(3),
        on_hand: m.onHand == null ? null : Number(m.onHand),
        shortfall_qty: orderQty,
        order_qty: orderQty,
        est_rate: estRate,
        est_amount: +(orderQty * estRate).toFixed(2),
        stock_item_code: m.stockItem?.code || null,
        sequence: i,
      };
    });
}

export async function listRequisitions() {
  const { data, error } = await supabase.from('purchase_requisition').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getRequisition(id) {
  const [{ data: pr, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
    supabase.from('purchase_requisition').select('*').eq('id', id).single(),
    supabase.from('purchase_requisition_line').select('*').eq('pr_id', id).order('sequence', { ascending: true }),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  return { ...pr, lines: lines || [] };
}

/** Create a PR from netted MRP materials. Returns the new PR with its number. */
export async function createFromShortfall(materials = [], rateByCode = {}, notes = 'Raised from MRP shortfall') {
  const lines = buildPrLines(materials, rateByCode);
  if (!lines.length) throw new Error('No shortfall materials to requisition.');
  const email = await currentEmail();
  const pr_number = await nextPrNumber();
  const total = lines.reduce((s, l) => s + (Number(l.est_amount) || 0), 0);
  const { data: pr, error } = await supabase.from('purchase_requisition')
    .insert({ pr_number, status: 'draft', source: 'mrp', notes, total_estimated: +total.toFixed(2), created_by_email: email })
    .select().single();
  if (error) throw error;
  const { error: lerr } = await supabase.from('purchase_requisition_line')
    .insert(lines.map((l) => ({ ...l, pr_id: pr.id })));
  if (lerr) throw lerr;
  return pr;
}

export async function transitionStatus(id, toStatus) {
  const patch = { status: toStatus };
  if (toStatus === 'submitted') patch.submitted_at = new Date().toISOString();
  if (toStatus === 'approved') patch.approved_at = new Date().toISOString();
  const { data, error } = await supabase.from('purchase_requisition').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Rates keyed by material_code, latest effective row wins. */
export async function rateMap() {
  const { data } = await supabase.from('material_rate').select('material_code, rate, effective_from').order('effective_from', { ascending: true });
  const m = {};
  (data || []).forEach((r) => { m[r.material_code] = Number(r.rate) || 0; });
  return m;
}

const purchaseRequisitionService = { buildPrLines, listRequisitions, getRequisition, createFromShortfall, transitionStatus, rateMap };
export default purchaseRequisitionService;

// Phase 4 — propagate recosted prices to open Sales Orders & Quotations.
// SO lines link to a costing_version directly (costing_version_id); quotation
// items match by product name. "Apply" re-prices to the costing's recommended
// net_selling_price. Closed/dispatched orders are never silently re-priced.
import { supabase } from '../lib/supabaseClient';

const OPEN_SO = ['draft', 'confirmed', 'released', 'in_planning', 'in_production', 'partially_dispatched'];
const r2 = (n) => +(Number(n) || 0).toFixed(2);

/** Open SO lines whose captured unit_price differs from the costing's current recommended price. */
export async function orderPriceImpact() {
  const { data: lines } = await supabase.from('sales_order_line')
    .select('id, so_id, product_name, qty, unit_price, line_value, costing_version_id').not('costing_version_id', 'is', null);
  if (!lines || !lines.length) return [];
  const cvIds = [...new Set(lines.map((l) => l.costing_version_id))];
  const soIds = [...new Set(lines.map((l) => l.so_id))];
  const [{ data: cvs }, { data: orders }] = await Promise.all([
    supabase.from('costing_version').select('id, net_selling_price, total_cost, target_margin_pct').in('id', cvIds),
    supabase.from('sales_order').select('id, so_number, company_name, status').in('id', soIds),
  ]);
  const cvById = Object.fromEntries((cvs || []).map((c) => [c.id, c]));
  const soById = Object.fromEntries((orders || []).map((o) => [o.id, o]));
  return lines.map((l) => {
    const cv = cvById[l.costing_version_id]; const so = soById[l.so_id];
    if (!cv || !so || !OPEN_SO.includes(so.status)) return null;
    const captured = r2(l.unit_price); const recommended = r2(cv.net_selling_price); const cost = r2(cv.total_cost);
    const delta = r2(recommended - captured);
    return {
      line_id: l.id, so_id: l.so_id, so_number: so.so_number, company_name: so.company_name, status: so.status,
      product_name: l.product_name, qty: Number(l.qty) || 0, captured, recommended, delta, cost,
      margin_at_captured: captured > 0 ? r2(((captured - cost) / captured) * 100) : 0,
      target_margin: Number(cv.target_margin_pct) || 0, stale: Math.abs(delta) > 0.01,
    };
  }).filter(Boolean).filter((r) => r.stale);
}

/** Re-price all costing-linked lines of an open order to the recommended price; recompute order totals. */
export async function applyOrderPrice(soId) {
  const { data: lines } = await supabase.from('sales_order_line').select('id, qty, costing_version_id').eq('so_id', soId).not('costing_version_id', 'is', null);
  const cvIds = [...new Set((lines || []).map((l) => l.costing_version_id))];
  const { data: cvs } = await supabase.from('costing_version').select('id, net_selling_price').in('id', cvIds);
  const price = Object.fromEntries((cvs || []).map((c) => [c.id, Number(c.net_selling_price) || 0]));
  for (const l of lines || []) {
    const p = price[l.costing_version_id]; if (p == null) continue;
    await supabase.from('sales_order_line').update({ unit_price: p, line_value: r2(p * (Number(l.qty) || 0)) }).eq('id', l.id);
  }
  const { data: all } = await supabase.from('sales_order_line').select('line_value, qty').eq('so_id', soId);
  const total = r2((all || []).reduce((s, l) => s + (Number(l.line_value) || 0), 0));
  const totalQty = (all || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
  await supabase.from('sales_order').update({ total_value: total, total_qty: totalQty, updated_at: new Date().toISOString() }).eq('id', soId);
  return { total };
}

/** Quotation items matched (by product name) to a current costing whose price has moved. */
export async function quotationPriceImpact() {
  const { data: items } = await supabase.from('crm_quotation_items').select('id, quotation_id, product, qty, unit_price, line_total');
  if (!items || !items.length) return [];
  const { data: cvs } = await supabase.from('costing_version').select('product_name, net_selling_price').neq('status', 'superseded');
  const recByName = {};
  (cvs || []).forEach((c) => { if (c.product_name) recByName[String(c.product_name).toLowerCase().trim()] = Number(c.net_selling_price) || 0; });
  const { data: quotes } = await supabase.from('crm_quotations').select('id, quote_number, status');
  const qById = Object.fromEntries((quotes || []).map((q) => [q.id, q]));
  return items.map((it) => {
    const rec = recByName[String(it.product || '').toLowerCase().trim()];
    if (rec == null) return null;
    const captured = r2(it.unit_price); const delta = r2(rec - captured); const q = qById[it.quotation_id];
    return { item_id: it.id, quotation_id: it.quotation_id, quote_number: q?.quote_number, status: q?.status,
      product: it.product, qty: Number(it.qty) || 0, captured, recommended: rec, delta, stale: Math.abs(delta) > 0.01 };
  }).filter(Boolean).filter((r) => r.stale);
}

export async function applyQuotationPrice(quotationId) {
  const { data: items } = await supabase.from('crm_quotation_items').select('id, product, qty').eq('quotation_id', quotationId);
  const { data: cvs } = await supabase.from('costing_version').select('product_name, net_selling_price').neq('status', 'superseded');
  const recByName = {};
  (cvs || []).forEach((c) => { if (c.product_name) recByName[String(c.product_name).toLowerCase().trim()] = Number(c.net_selling_price) || 0; });
  for (const it of items || []) {
    const rec = recByName[String(it.product || '').toLowerCase().trim()]; if (rec == null) continue;
    await supabase.from('crm_quotation_items').update({ unit_price: rec, line_total: r2(rec * (Number(it.qty) || 0)) }).eq('id', it.id);
  }
  const { data: all } = await supabase.from('crm_quotation_items').select('line_total').eq('quotation_id', quotationId);
  const subtotal = r2((all || []).reduce((s, l) => s + (Number(l.line_total) || 0), 0));
  await supabase.from('crm_quotations').update({ subtotal, total: subtotal }).eq('id', quotationId);
  return { subtotal };
}

const priceImpactService = { orderPriceImpact, applyOrderPrice, quotationPriceImpact, applyQuotationPrice };
export default priceImpactService;

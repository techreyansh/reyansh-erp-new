// Demand forecast — statistical (no AI). Reorder prediction from customer
// order cadence + product demand from sales-order-line history.
import { supabase } from '../lib/supabaseClient';
import { reorderForecast as reorderFn, forecastProducts } from './forecastEngine';

const today = () => new Date().toISOString().slice(0, 10);

/** Customers expected to reorder within horizonDays (incl. overdue). */
export async function reorderForecast(ownerEmail = null, horizonDays = 60) {
  const { data, error } = await supabase.rpc('crm_customer_analytics');
  if (error) throw error;
  let rows = Array.isArray(data) ? data : [];
  rows = rows.map((c) => ({ ...c, customer_code: c.client_code || c.customer_code }));
  if (ownerEmail) rows = rows.filter((c) => !c.owner_email || c.owner_email === ownerEmail);
  const list = reorderFn(rows, today(), horizonDays);
  const expectedValue = list.reduce((s, c) => s + (Number(c.expected_value) || 0), 0);
  return {
    list,
    kpis: {
      due30: list.filter((c) => c.days_until <= 30).length,
      overdue: list.filter((c) => c.overdue).length,
      expectedValue: +expectedValue.toFixed(2),
      total: list.length,
    },
  };
}

/** Per-product demand forecast from released sales-order lines. */
export async function productForecast(periods = 3) {
  const { data: lines } = await supabase.from('sales_order_line').select('product_code, product_name, qty, uom, so_id');
  if (!lines || !lines.length) return { products: [], periods, lineCount: 0 };
  const soIds = [...new Set(lines.map((l) => l.so_id).filter(Boolean))];
  const { data: orders } = await supabase.from('sales_order').select('id, created_at, expected_dispatch_date').in('id', soIds);
  const dateById = Object.fromEntries((orders || []).map((o) => [o.id, (o.expected_dispatch_date || o.created_at || '').slice(0, 10)]));
  const rows = lines.map((l) => ({ ...l, date: dateById[l.so_id] || null })).filter((l) => l.date);
  const products = forecastProducts(rows, { dateKey: 'date', qtyKey: 'qty', periods });
  return { products, periods, lineCount: lines.length };
}

const demandForecastService = { reorderForecast, productForecast };
export default demandForecastService;

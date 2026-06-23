// Demand forecast engine (pure). Statistical forecasting from order history —
// linear trend + moving average for product demand, cadence-based reorder
// prediction for customers. No AI/LLM, no network, fully testable.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Least-squares fit over y-values (x = 0..n-1). Returns {slope, intercept}. */
export function linearFit(values = []) {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: Number(values[0]) || 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  values.forEach((v, x) => { const y = Number(v) || 0; sx += x; sy += y; sxx += x * x; sxy += x * y; });
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

export function movingAverage(values = [], window = 3) {
  if (!values.length) return 0;
  const w = Math.min(window, values.length);
  const slice = values.slice(-w);
  return slice.reduce((s, v) => s + (Number(v) || 0), 0) / w;
}

/** Add `n` months to a 'YYYY-MM' string. */
export function addMonths(period, n) {
  const [y, m] = String(period).split('-').map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Bucket rows into monthly summed quantity. @returns sorted [{period, qty}]. */
export function monthlySeries(rows = [], dateKey, qtyKey) {
  const buckets = {};
  rows.forEach((r) => {
    const d = r[dateKey];
    if (!d) return;
    const period = String(d).slice(0, 7); // YYYY-MM
    buckets[period] = (buckets[period] || 0) + (Number(r[qtyKey]) || 0);
  });
  return Object.entries(buckets).map(([period, qty]) => ({ period, qty: r2(qty) })).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Forecast the next `periods` months of demand for one series.
 * ≥3 points → linear trend; else moving-average / last value.
 */
export function forecastSeries(series = [], periods = 3) {
  const values = series.map((p) => Number(p.qty) || 0);
  const lastPeriod = series.length ? series[series.length - 1].period : null;
  let method, predictAt;
  if (values.length >= 3) {
    const { slope, intercept } = linearFit(values);
    method = 'trend';
    predictAt = (i) => Math.max(0, intercept + slope * (values.length - 1 + i));
  } else if (values.length >= 1) {
    const ma = movingAverage(values, values.length);
    method = values.length === 1 ? 'last' : 'avg';
    predictAt = () => Math.max(0, ma);
  } else {
    return { history: series, forecast: [], method: 'none', avg: 0, slope: 0 };
  }
  const forecast = [];
  for (let i = 1; i <= periods; i += 1) forecast.push({ period: lastPeriod ? addMonths(lastPeriod, i) : `+${i}`, qty: r2(predictAt(i)), projected: true });
  const { slope } = values.length >= 2 ? linearFit(values) : { slope: 0 };
  return { history: series, forecast, method, avg: r2(movingAverage(values, 3)), slope: r2(slope) };
}

/** Forecast demand per product from order-line rows. */
export function forecastProducts(lines = [], { dateKey = 'date', qtyKey = 'qty', periods = 3 } = {}) {
  const byProduct = {};
  lines.forEach((l) => {
    const key = l.product_code || l.product_name || 'unknown';
    (byProduct[key] ||= { code: l.product_code || '', name: l.product_name || key, uom: l.uom || '', rows: [] }).rows.push(l);
  });
  return Object.values(byProduct).map((p) => {
    const series = monthlySeries(p.rows, dateKey, qtyKey);
    const f = forecastSeries(series, periods);
    return { code: p.code, name: p.name, uom: p.uom, ...f, nextQty: f.forecast[0]?.qty || 0, total: r2(series.reduce((s, x) => s + x.qty, 0)) };
  }).sort((a, b) => b.nextQty - a.nextQty);
}

/**
 * Cadence-based reorder forecast from per-customer analytics rows
 * ([{company_name, last_order, cadence_days, value_12mo, order_count, next_expected, due_status}]).
 * Returns customers expected to reorder within `horizonDays` (incl. overdue), soonest first.
 */
export function reorderForecast(customers = [], today = new Date().toISOString().slice(0, 10), horizonDays = 60) {
  const t = new Date(today);
  const out = [];
  customers.forEach((c) => {
    const cadence = Number(c.cadence_days);
    let next = c.next_expected;
    if (!next && c.last_order && Number.isFinite(cadence) && cadence > 0) {
      const d = new Date(c.last_order); d.setDate(d.getDate() + cadence); next = d.toISOString().slice(0, 10);
    }
    if (!next) return;
    const days = Math.round((new Date(next) - t) / 86400000);
    if (days > horizonDays) return;
    const expectedValue = Number(c.order_count) > 0 ? r2(Number(c.value_12mo || 0) / Math.max(1, Number(c.order_count))) : 0;
    out.push({
      company_name: c.company_name, customer_code: c.customer_code, owner_email: c.owner_email,
      next_expected: next, days_until: days, overdue: days < 0,
      cadence_days: Number.isFinite(cadence) ? cadence : null, order_count: Number(c.order_count) || 0,
      expected_value: expectedValue, due_status: c.due_status || (days < 0 ? 'overdue' : days <= 14 ? 'due_soon' : 'upcoming'),
    });
  });
  return out.sort((a, b) => a.days_until - b.days_until);
}

const forecastEngine = { linearFit, movingAverage, addMonths, monthlySeries, forecastSeries, forecastProducts, reorderForecast };
export default forecastEngine;

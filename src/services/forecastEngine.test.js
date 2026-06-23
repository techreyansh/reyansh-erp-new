import { linearFit, movingAverage, addMonths, monthlySeries, forecastSeries, forecastProducts, reorderForecast } from './forecastEngine';

test('linearFit recovers slope and intercept', () => {
  const { slope, intercept } = linearFit([10, 20, 30, 40]); // y = 10 + 10x
  expect(slope).toBeCloseTo(10, 6);
  expect(intercept).toBeCloseTo(10, 6);
});

test('movingAverage over last window', () => {
  expect(movingAverage([10, 20, 30], 2)).toBe(25);
  expect(movingAverage([5], 3)).toBe(5);
});

test('addMonths rolls over year boundary', () => {
  expect(addMonths('2026-11', 3)).toBe('2027-02');
  expect(addMonths('2026-01', 1)).toBe('2026-02');
});

test('monthlySeries buckets and sums by month', () => {
  const s = monthlySeries([
    { d: '2026-01-05', q: 100 }, { d: '2026-01-20', q: 50 }, { d: '2026-03-01', q: 200 },
  ], 'd', 'q');
  expect(s).toEqual([{ period: '2026-01', qty: 150 }, { period: '2026-03', qty: 200 }]);
});

test('forecastSeries uses trend with >=3 points', () => {
  const series = [{ period: '2026-01', qty: 100 }, { period: '2026-02', qty: 200 }, { period: '2026-03', qty: 300 }];
  const f = forecastSeries(series, 2);
  expect(f.method).toBe('trend');
  expect(f.forecast[0]).toMatchObject({ period: '2026-04', qty: 400 });
  expect(f.forecast[1].qty).toBe(500);
});

test('forecastSeries falls back to last value with 1 point, never negative', () => {
  const f = forecastSeries([{ period: '2026-03', qty: 80 }], 2);
  expect(f.method).toBe('last');
  expect(f.forecast.every((x) => x.qty === 80)).toBe(true);
  const down = forecastSeries([{ period: '2026-01', qty: 30 }, { period: '2026-02', qty: 20 }, { period: '2026-03', qty: 10 }], 3);
  expect(down.forecast.every((x) => x.qty >= 0)).toBe(true); // clamped at 0
});

test('forecastProducts groups by product and ranks by next forecast', () => {
  const lines = [
    { product_code: 'A', product_name: 'Cord A', uom: 'pc', date: '2026-01-01', qty: 100 },
    { product_code: 'A', product_name: 'Cord A', uom: 'pc', date: '2026-02-01', qty: 150 },
    { product_code: 'A', product_name: 'Cord A', uom: 'pc', date: '2026-03-01', qty: 200 },
    { product_code: 'B', product_name: 'Cord B', uom: 'pc', date: '2026-03-01', qty: 10 },
  ];
  const out = forecastProducts(lines, { dateKey: 'date', qtyKey: 'qty', periods: 1 });
  expect(out[0].code).toBe('A'); // higher next forecast
  expect(out[0].nextQty).toBeGreaterThan(out[1].nextQty);
});

test('reorderForecast surfaces overdue + within-horizon, soonest first', () => {
  const customers = [
    { company_name: 'X', last_order: '2026-05-01', cadence_days: 30, order_count: 4, value_12mo: 40000 }, // next ~05-31, overdue vs 06-23
    { company_name: 'Y', next_expected: '2026-07-01', cadence_days: 60, order_count: 2, value_12mo: 20000 }, // upcoming
    { company_name: 'Z', next_expected: '2026-12-01' }, // beyond horizon → excluded
  ];
  const out = reorderForecast(customers, '2026-06-23', 60);
  expect(out.map((c) => c.company_name)).toEqual(['X', 'Y']);
  expect(out[0].overdue).toBe(true);
  expect(out[0].expected_value).toBe(10000); // 40000 / 4
});

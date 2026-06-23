import { summarizeOperations } from './operationsControlService';

const base = {
  today: '2026-06-23',
  orders: [
    { status: 'draft', total_value: 1000 },
    { status: 'released', total_value: 50000 },
    { status: 'in_production', total_value: 30000 },
    { status: 'dispatched', total_value: 20000 },
    { status: 'cancelled', total_value: 9999 },
  ],
  dispatches: [
    { dispatch_date: '2026-06-20', actual_dispatch_date: null, status: 'planned' }, // overdue
    { dispatch_date: '2026-06-30', actual_dispatch_date: null, status: 'planned' }, // upcoming
    { dispatch_date: '2026-06-19', actual_dispatch_date: '2026-06-19', status: 'dispatched' }, // done
  ],
  demands: [
    { status: 'open', required_date: '2026-06-20' }, // behind
    { status: 'done', required_date: '2026-06-10' },
  ],
  invoices: [
    { amount: 69620, balance: 20000, due_date: '2026-06-15', status: 'issued' }, // overdue AR
    { amount: 10000, balance: 0, due_date: '2026-07-01', status: 'paid' },
    { amount: 5000, balance: 5000, due_date: '2026-06-01', status: 'cancelled' }, // ignored
  ],
  mrpShortCount: 3,
  uninvoicedCount: 2,
  uninvoicedValue: 50000,
};

test('funnel buckets orders by stage and excludes cancelled', () => {
  const r = summarizeOperations(base);
  const byKey = Object.fromEntries(r.funnel.map((f) => [f.key, f]));
  expect(byKey.Draft.count).toBe(1);
  expect(byKey.Confirmed.count).toBe(1); // released
  expect(byKey['In Production'].count).toBe(1);
  expect(byKey.Fulfilled.count).toBe(1); // dispatched
  expect(r.cancelled).toBe(1);
});

test('money flow: backlog, invoiced, collected, outstanding', () => {
  const r = summarizeOperations(base);
  // open orders = released + in_production = 80000
  expect(r.money.orderBacklogValue).toBe(80000);
  // live invoices (exclude cancelled) = 69620 + 10000
  expect(r.money.invoicedValue).toBe(79620);
  expect(r.money.outstandingValue).toBe(20000);
  expect(r.money.collectedValue).toBe(59620);
});

test('attention rail surfaces and prioritizes high severity first', () => {
  const r = summarizeOperations(base);
  const codes = r.attention.map((a) => a.code);
  expect(codes).toContain('dispatch_overdue');
  expect(codes).toContain('ar_overdue');
  expect(codes).toContain('prod_behind');
  expect(codes).toContain('mrp_short');
  expect(codes).toContain('uninvoiced');
  // high severity (dispatch/AR) come before med
  expect(r.attention[0].severity).toBe('high');
});

test('empty input is safe', () => {
  const r = summarizeOperations({});
  expect(r.attention).toEqual([]);
  expect(r.money.invoicedValue).toBe(0);
  expect(r.funnel.length).toBe(5);
});

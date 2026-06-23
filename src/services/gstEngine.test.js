import { computeInvoice, isInterState } from './gstEngine';

const lines = [
  { product_name: 'Power cord 3-pin', qty: 1000, rate: 42, gst_rate: 18 },
  { product_name: 'Wire harness', qty: 200, rate: 85, gst_rate: 18 },
];

test('intra-state splits tax into CGST+SGST', () => {
  const r = computeInvoice(lines, { interState: false });
  // taxable = 42000 + 17000 = 59000
  expect(r.taxable).toBe(59000);
  // tax @18% = 10620 → cgst 5310, sgst 5310, igst 0
  expect(r.cgst).toBe(5310);
  expect(r.sgst).toBe(5310);
  expect(r.igst).toBe(0);
  expect(r.taxTotal).toBe(10620);
  expect(r.grandTotal).toBe(69620);
  expect(r.cgst + r.sgst).toBe(r.taxTotal);
});

test('inter-state uses IGST only', () => {
  const r = computeInvoice(lines, { interState: true });
  expect(r.igst).toBe(10620);
  expect(r.cgst).toBe(0);
  expect(r.sgst).toBe(0);
  expect(r.grandTotal).toBe(69620);
});

test('round-off nudges grand total to nearest rupee', () => {
  const r = computeInvoice([{ qty: 1, rate: 100, gst_rate: 5 }], { interState: false });
  // taxable 100, tax 5 → 105 exactly, round_off 0
  expect(r.grandTotal).toBe(105);
  const r2 = computeInvoice([{ qty: 3, rate: 33.33, gst_rate: 18 }], { interState: true });
  // taxable 99.99, igst 18.00 → 117.99 → round to 118, round_off 0.01
  expect(r2.grandTotal).toBe(118);
  expect(r2.roundOff).toBeCloseTo(0.01, 2);
});

test('per-line gst_rate overrides the default', () => {
  const r = computeInvoice([{ qty: 10, rate: 100, gst_rate: 12 }], { gstRate: 18, interState: true });
  expect(r.igst).toBe(120); // 1000 × 12%
});

test('isInterState only when both codes known and differ', () => {
  expect(isInterState('27', '29')).toBe(true);
  expect(isInterState('27', '27')).toBe(false);
  expect(isInterState('', '29')).toBe(false);
});

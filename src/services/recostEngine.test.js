import { repriceLines, costAt, costImpact, isStale } from './recostEngine';

// A realistic 3-pin power cord costing: copper + PVC + labour + 8% overhead.
const lines = [
  { material_code: 'COPPER', section: 'material', qty: 0.4, rate: 745, is_percentage: false, rate_overridden: false },
  { material_code: 'PVC_INS', section: 'material', qty: 0.3, rate: 110, is_percentage: false, rate_overridden: false },
  { material_code: 'LABOUR_RATE', section: 'labour', qty: 1, rate: 20, is_percentage: false, rate_overridden: false },
  { material_code: 'OVERHEAD_PCT', section: 'overhead', is_percentage: true, pct_basis: 'material', rate: 8, rate_overridden: false },
];
const current = { COPPER: 745, PVC_INS: 110, LABOUR_RATE: 20, OVERHEAD_PCT: 8 };

test('repriceLines updates non-frozen material lines, leaves frozen + percentage', () => {
  const out = repriceLines(lines, { COPPER: 1020, PVC_INS: 110, LABOUR_RATE: 20, OVERHEAD_PCT: 8 });
  expect(out[0].rate).toBe(1020);
  expect(out[0].amount).toBe(408); // 0.4 × 1020
  expect(out[1].rate).toBe(110); // unchanged
  expect(out[3].is_percentage).toBe(true);
});

test('rate_overridden lines are NOT re-priced (frozen)', () => {
  const frozen = [{ ...lines[0], rate_overridden: true }];
  const out = repriceLines(frozen, { COPPER: 1020 });
  expect(out[0].rate).toBe(745); // stays frozen
});

test('changing copper rate flows through to total cost (THE core requirement)', () => {
  const before = costAt(lines, current, 20);
  const after = costAt(lines, { ...current, COPPER: 1020 }, 20);
  // material: copper 0.4×745=298 → 0.4×1020=408 (+110); pvc 33 both; overhead 8% of material
  expect(before.material_cost).toBe(331); // 298 + 33
  expect(after.material_cost).toBe(441);  // 408 + 33
  expect(after.total_cost).toBeGreaterThan(before.total_cost);
  expect(after.total_cost - before.total_cost).toBeCloseTo(110 + 0.08 * 110, 1); // material + its overhead
  // selling price rises, and margin holds because price is derived from cost at target margin
  expect(after.net_selling_price).toBeGreaterThan(before.net_selling_price);
});

test('costImpact returns current vs new vs delta without mutating', () => {
  const imp = costImpact(lines, current, { COPPER: 1020 }, 20);
  expect(imp.current.total_cost).toBeLessThan(imp.new.total_cost);
  expect(imp.delta.total_cost).toBeCloseTo(118.8, 1); // 110 + 8.8 overhead
  expect(imp.delta.material_cost).toBe(110);
  expect(imp.delta.total_cost_pct).toBeGreaterThan(0);
});

test('isStale detects a saved version priced at old rates', () => {
  const savedAtOldCopper = { total_cost: costAt(lines, current, 20).total_cost, target_margin_pct: 20 };
  expect(isStale(savedAtOldCopper, lines, current)).toBe(false);
  expect(isStale(savedAtOldCopper, lines, { ...current, COPPER: 1020 })).toBe(true);
});

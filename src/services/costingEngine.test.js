import { recompute, lineAmount } from './costingEngine';

describe('costingEngine.recompute', () => {
  test('sums sections and prices off target margin (margin on selling price)', () => {
    const lines = [
      { section: 'material', amount: 300 },
      { section: 'labour', qty: 2, rate: 25 },        // 50
      { section: 'machine', amount: 20 },
      { section: 'overhead', amount: 10 },
      { section: 'financial', amount: 5 },
    ];
    const r = recompute(lines, { targetMarginPct: 20 });
    expect(r.material_cost).toBe(300);
    expect(r.labour_cost).toBe(50);
    expect(r.total_cost).toBe(385);
    // price = 385 / 0.8 = 481.25
    expect(r.net_selling_price).toBe(481.25);
    expect(r.net_margin_pct).toBeCloseTo(20, 1);
    // gross excludes overhead+financial: (price-(300+50+20))/price
    expect(r.gross_margin_pct).toBeCloseTo(((481.25 - 370) / 481.25) * 100, 1);
    expect(r.contribution_pct).toBeCloseTo(((481.25 - 350) / 481.25) * 100, 1);
  });

  test('percentage lines apply against their base after absolutes', () => {
    const lines = [
      { section: 'material', amount: 100 },
      { section: 'overhead', is_percentage: true, pct_basis: 'material', amount: 10 }, // 10% of 100 = 10
    ];
    const r = recompute(lines, { targetMarginPct: 0 });
    expect(r.overhead_cost).toBe(10);
    expect(r.total_cost).toBe(110);
    expect(r.net_selling_price).toBe(110); // 0 margin → price = cost
  });

  test('lineAmount prefers explicit amount, else qty*rate', () => {
    expect(lineAmount({ amount: 42 })).toBe(42);
    expect(lineAmount({ qty: 3, rate: 4 })).toBe(12);
    expect(lineAmount({ is_percentage: true, amount: 10 })).toBe(0);
  });

  test('handles empty/garbage input', () => {
    const r = recompute([], {});
    expect(r.total_cost).toBe(0);
    expect(r.net_selling_price).toBe(0);
  });
});

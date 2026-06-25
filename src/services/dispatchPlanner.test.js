import { backwardPlan, subtractWorkingDays, readiness, planRisk, totalLeadDays, DISPATCH_STAGES } from './dispatchPlanner';

describe('dispatchPlanner', () => {
  test('subtractWorkingDays skips Sundays', () => {
    // 2026-06-22 is a Monday. minus 1 working day = Saturday 2026-06-20 (skip Sunday 21).
    const d = subtractWorkingDays(new Date('2026-06-22'), 1);
    expect(d.toISOString().slice(0, 10)).toBe('2026-06-20');
  });

  test('backwardPlan returns the chain working backwards from dispatch', () => {
    const plan = backwardPlan('2026-06-25', DISPATCH_STAGES);
    const byKey = Object.fromEntries(plan.map((s) => [s.key, s.due_date]));
    // 25 Jun (Thu). packing -1wd = 24, inspection -1 = 23, testing -1 = 22 (Mon),
    // moulding -2 = 19 (Fri, skip Sun 21? from 22 back 2 wd: 20 Sat, 19 Fri)
    expect(byKey.packing).toBe('2026-06-24');
    expect(byKey.testing).toBe('2026-06-22');
    expect(plan[plan.length - 1].key).toBe('purchase');
    // every stage strictly earlier than the previous
    for (let i = 1; i < plan.length; i++) {
      expect(new Date(plan[i].due_date) <= new Date(plan[i - 1].due_date)).toBe(true);
    }
  });

  test('totalLeadDays sums the chain', () => {
    expect(totalLeadDays()).toBe(15); // 1+1+1+2+2+2+3+3
  });

  test('readiness bands + overall', () => {
    const r = readiness({ material: 90, cable: 100, assembly: 75, quality: 100, packing: 60 });
    expect(r.overall).toBe(85);
    expect(r.bands.find((b) => b.key === 'assembly').band).toBe('yellow');
    expect(r.bands.find((b) => b.key === 'cable').band).toBe('green');
    expect(r.bands.find((b) => b.key === 'packing').band).toBe('yellow');
    expect(readiness({}).overall).toBe(0);
  });

  test('planRisk flags overdue backward stages', () => {
    const plan = backwardPlan('2026-06-25');
    const risk = planRisk(plan, new Date('2026-06-24')); // purchase/material already past
    expect(risk.atRisk).toBe(true);
    expect(risk.overdueStages.length).toBeGreaterThan(0);
  });
});

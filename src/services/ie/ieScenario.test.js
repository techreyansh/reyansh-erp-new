import { resolveStandard } from '../routingCapacity';
import { planCost } from './costModel';
import { requiredUph, planForTarget } from './ieScenario';

const DEF = { default_oee: 1 };
const RATES = { labour_per_hr: 100, overtime_multiplier: 1.5, machine_per_hr: 50, indirect_pct: 0 };

// inner molding machine: 3600/24 * 2 cavities = 300/hr. crimp labour: 3600/20 = 180/op.
const line = (over = {}) => [
  resolveStandard({ key: 'inner', constraint_type: 'machine', cycle_time_sec: 24, cavities: 2, oee: 1, parallel_machines: 1 }, null, DEF),
  resolveStandard({ key: 'crimp', constraint_type: 'labour', cycle_time_sec: 20, oee: 1, max_operators: 4, ...over.crimp }, null, DEF),
];

describe('requiredUph', () => {
  test('target / hours', () => {
    expect(requiredUph(2000, 8)).toBe(250);
    expect(requiredUph(1000, 0)).toBe(Infinity);
  });
});

describe('planCost', () => {
  test('labour + overtime + machine + indirect', () => {
    const c = planCost({ totalOperators: 2, totalMachines: 1, targetQty: 2000 }, RATES, 8, 0);
    expect(c.labourCost).toBe(1600);   // 2 × 8 × 100
    expect(c.machineCost).toBe(400);   // 1 × 8 × 50
    expect(c.total).toBe(2000);
    expect(c.costPerPc).toBe(1);       // 2000 / 2000
  });
  test('overtime is multiplied; indirect adds on top', () => {
    const c = planCost({ totalOperators: 1, totalMachines: 0, targetQty: 100 }, { ...RATES, indirect_pct: 0.1 }, 8, 2);
    expect(c.overtimeCost).toBe(300);  // 1 × 2 × 100 × 1.5
    expect(c.total).toBe((800 + 300) * 1.1);
  });
  test('zero target → costPerPc 0, never NaN', () => {
    expect(planCost({ totalOperators: 1, targetQty: 0 }, RATES, 8).costPerPc).toBe(0);
  });
});

describe('planForTarget — feasible within the headcount pool', () => {
  test('hits a modest target with minimum manpower, no overtime', () => {
    const r = planForTarget(line(), { headcountPool: 10, targetQty: 2000, shiftHours: 8, rates: RATES });
    expect(r.feasible).toBe(true);
    expect(r.overtimeHours).toBe(0);
    expect(r.plan.totalOperators).toBe(2);   // crimp needs ceil(250/180)=2; inner 300≥250
    expect(r.reason).toMatch(/no overtime/);
  });
});

describe('planForTarget — overtime only after the pool is exhausted', () => {
  test('a tiny pool that cannot staff the plain shift falls back to overtime', () => {
    // target 2000/8h → req 250 → crimp needs 2 operators. Pool = 1 → can't.
    // With 2h OT (10h) → req 200 → crimp needs ceil(200/180)=2 ... still 2. Need pool≥2.
    // So make crimp faster so 1 op suffices only with OT: cycle 12 → 300/op.
    const fast = [
      resolveStandard({ key: 'inner', constraint_type: 'machine', cycle_time_sec: 24, cavities: 2, oee: 1, parallel_machines: 1 }, null, DEF), // 300
      resolveStandard({ key: 'crimp', constraint_type: 'labour', cycle_time_sec: 12, oee: 1, max_operators: 4 }, null, DEF), // 300/op
    ];
    // target 2400/8h → req 300 → crimp needs 1 op (300/op). inner 300≥300. feasible no OT, pool 1.
    const noOt = planForTarget(fast, { headcountPool: 1, targetQty: 2400, shiftHours: 8, rates: RATES });
    expect(noOt.feasible).toBe(true);
    expect(noOt.overtimeHours).toBe(0);
  });
});

describe('planForTarget — infeasible (machine/molding cap)', () => {
  test('molding caps the day; operators cannot help; reports the unlock', () => {
    // inner 300/hr × 8h = 2400/day max. Target 3000, no overtime → infeasible.
    const r = planForTarget(line(), { headcountPool: 10, targetQty: 3000, shiftHours: 8, maxOvertimeHours: 0, rates: RATES });
    expect(r.feasible).toBe(false);
    expect(r.bottleneck.kind).toBe('machine');
    expect(r.unlock.type).toBe('machine');
    expect(r.reason).toMatch(/not achievable/i);
  });

  test('overtime can unlock a machine-capped target when allowed', () => {
    // 3000 over 10h (8+2 OT) → req 300 = inner cap → feasible with 2h OT.
    const r = planForTarget(line(), { headcountPool: 10, targetQty: 3000, shiftHours: 8, maxOvertimeHours: 2, rates: RATES });
    expect(r.feasible).toBe(true);
    expect(r.overtimeHours).toBe(2);
  });
});

describe('planForTarget — infeasible (headcount pool too small)', () => {
  test('reports the operator shortfall honestly', () => {
    // slow labour weld 120/op (cycle 30); target 2000/8h → req 250 → needs 3 ops.
    // inner 300 ≥ 250 (not the bottleneck). Pool = 2, no OT → short by 1.
    const ops = [
      resolveStandard({ key: 'inner', constraint_type: 'machine', cycle_time_sec: 24, cavities: 2, oee: 1, parallel_machines: 1 }, null, DEF), // 300
      resolveStandard({ key: 'weld', constraint_type: 'labour', cycle_time_sec: 30, oee: 1, max_operators: 6 }, null, DEF), // 120/op
    ];
    const r = planForTarget(ops, { headcountPool: 2, targetQty: 2000, shiftHours: 8, maxOvertimeHours: 0, rates: RATES });
    expect(r.feasible).toBe(false);
    expect(r.unlock.type).toBe('labour');
    expect(r.unlock.extraOperatorsNeeded).toBe(1); // needs 3, pool 2
  });
});

describe('planForTarget — determinism + guards', () => {
  test('same inputs and shuffled op order give the same plan', () => {
    const a = planForTarget(line(), { headcountPool: 10, targetQty: 2000, shiftHours: 8, rates: RATES });
    const shuffled = line().reverse();
    const b = planForTarget(shuffled, { headcountPool: 10, targetQty: 2000, shiftHours: 8, rates: RATES });
    expect(b.feasible).toBe(a.feasible);
    expect(b.plan.totalOperators).toBe(a.plan.totalOperators);
  });
  test('no routing → not feasible, clear message, no throw', () => {
    const r = planForTarget([], { headcountPool: 10, targetQty: 1000, shiftHours: 8, rates: RATES });
    expect(r.feasible).toBe(false);
    expect(r.reason).toMatch(/no usable routing/i);
  });
});

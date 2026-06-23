import { buildPlan } from './cablePlanService';

const stagesOf = (p) => p.routing.map((r) => r.stage);
const base = { conductorSize: 1.5, numStrands: 32, coreOd: 2.2 };

/* ---- routing ---- */
test('3-core 32-strand → bunching + core + laying + sheathing (all 4)', () => {
  const p = buildPlan({ ...base, cores: 3, orderQty: 1000, requiredLength: 2 });
  expect(stagesOf(p)).toEqual(['bunching', 'core', 'laying', 'sheathing']);
  expect(p.totalMeters).toBe(2000);
});

test('1-core 7-strand → core only', () => {
  const p = buildPlan({ cores: 1, numStrands: 7, conductorSize: 1.0, coreOd: 1.6, orderQty: 500, requiredLength: 3 });
  expect(stagesOf(p)).toEqual(['core']);
  expect(p.departments.bunching.required).toBe(false);
  expect(p.departments.laying.required).toBe(false);
});

test('2-core 30-strand → bunching + core + sheathing (no laying, cores<3)', () => {
  const p = buildPlan({ ...base, cores: 2, numStrands: 30, conductorSize: 0.75, orderQty: 200, requiredLength: 5 });
  expect(stagesOf(p)).toEqual(['bunching', 'core', 'sheathing']);
  expect(p.departments.laying.required).toBe(false);
});

/* ---- CORRECTED bunching math: length × cores ---- */
test('bunching length = finished × cores (no loss/wastage)', () => {
  const p = buildPlan({ ...base, cores: 3, orderQty: 1000, requiredLength: 1, wastagePct: 0, layingLossPct: 0 });
  expect(p.finishedLength).toBe(1000);
  expect(p.summary.coreProductionLength).toBe(3000);     // 3 cores × 1000
  expect(p.departments.bunching.length).toBe(3000);      // bunching feeds all cores
});

test('2C/3C/4C bunching scales with cores', () => {
  const mk = (cores) => buildPlan({ ...base, cores, orderQty: 1000, requiredLength: 1, wastagePct: 0, layingLossPct: 0 });
  expect(mk(2).departments.bunching.length).toBe(2000);
  expect(mk(3).departments.bunching.length).toBe(3000);
  expect(mk(4).departments.bunching.length).toBe(4000);
});

/* ---- laying loss inflates required core production (3/4-core) ---- */
test('laying loss % raises required core production', () => {
  const p = buildPlan({ ...base, cores: 3, orderQty: 1000, requiredLength: 1, wastagePct: 0, layingLossPct: 2 });
  expect(p.requiredCorePerCore).toBe(1020);              // 1000 × 1.02
  expect(p.summary.coreProductionLength).toBe(3060);     // × 3 cores
  expect(p.config.layingLossPct).toBe(2);
});

test('laying loss ignored for <3 cores', () => {
  const p = buildPlan({ ...base, cores: 2, orderQty: 1000, requiredLength: 1, layingLossPct: 5 });
  expect(p.config.layingLossPct).toBe(0);
  expect(p.requiredCorePerCore).toBe(1000);
});

/* ---- per-core extrusion rows ---- */
test('core extrusion produces one row per core with planner Core OD', () => {
  const p = buildPlan({ ...base, cores: 3, orderQty: 1000, requiredLength: 1, coreColours: 'Red, Black, Yellow-Green' });
  expect(p.departments.core.rows).toHaveLength(3);
  expect(p.departments.core.rows.map((r) => r.colour)).toEqual(['Red', 'Black', 'Yellow-Green']);
  p.departments.core.rows.forEach((r) => expect(r.coreOd).toBe(2.2));
});

/* ---- planner wastage default + application ---- */
test('wastage defaults to 2% and applies to material + planning length', () => {
  const p = buildPlan({ ...base, cores: 3, orderQty: 1000, requiredLength: 2 });
  expect(p.config.wastagePct).toBe(2);
  expect(p.material.estWastageCopper).toBeCloseTo(p.material.copper * 0.02, 2);
});

/* ---- machine capacity / hours / utilisation present ---- */
test('machine load summary has capacity, hours and utilisation per stage', () => {
  const p = buildPlan({ ...base, cores: 3, orderQty: 1000, requiredLength: 2 });
  expect(p.summary.machineLoad.length).toBe(4);
  p.summary.machineLoad.forEach((ml) => {
    expect(ml.capacity).toBeGreaterThan(0);
    expect(ml.hours).toBeGreaterThan(0);
    expect(ml.utilizationPct).toBeGreaterThan(0);
  });
  expect(p.summary.leadDays).toBeGreaterThan(0);
});

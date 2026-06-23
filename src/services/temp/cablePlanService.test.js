import { buildPlan } from './cablePlanService';

const stagesOf = (p) => p.routing.map((r) => r.stage);

test('3-core 32-strand → bunching + core + laying + sheathing (all 4)', () => {
  const p = buildPlan({ cores: 3, numStrands: 32, conductorSize: 1.5, orderQty: 1000, requiredLength: 2 });
  expect(stagesOf(p)).toEqual(['bunching', 'core', 'laying', 'sheathing']);
  expect(p.departments.bunching.required).toBe(true);
  expect(p.departments.laying.required).toBe(true);
  expect(p.totalMeters).toBe(2000);
});

test('1-core 7-strand → core only (no bunching, no laying, no sheath)', () => {
  const p = buildPlan({ cores: 1, numStrands: 7, conductorSize: 1.0, orderQty: 500, requiredLength: 3 });
  expect(stagesOf(p)).toEqual(['core']);
  expect(p.departments.bunching.required).toBe(false);
  expect(p.departments.laying.required).toBe(false);
  expect(p.departments.sheathing.required).toBe(false);
});

test('2-core 30-strand → bunching + core + sheathing (no laying, cores<3)', () => {
  const p = buildPlan({ cores: 2, numStrands: 30, conductorSize: 0.75, orderQty: 200, requiredLength: 5 });
  expect(stagesOf(p)).toEqual(['bunching', 'core', 'sheathing']);
  expect(p.departments.laying.required).toBe(false);
});

test('material estimate present with copper + pvc + wastage', () => {
  const p = buildPlan({ cores: 3, numStrands: 32, conductorSize: 1.5, orderQty: 1000, requiredLength: 2 });
  expect(p.material.copper).toBeGreaterThan(0);
  expect(p.material.pvcTotal).toBeGreaterThan(0);
  expect(p.material.estWastageCopper).toBeCloseTo(p.material.copper * 0.05, 1);
});

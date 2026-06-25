import { buildPlan } from './cablePlanService';
import { buildDaySchedule } from './cableScheduleService';

const base = { cores: 3, numStrands: 32, conductorSize: 1.5, coreOd: 2.2, requiredLength: 1 };
const mkPlan = (planNumber, qty, extra = {}) => ({
  planNumber, customer: 'C', product: '3 Core', priority: 'normal', deliveryDate: '2026-06-25',
  plan: buildPlan({ ...base, orderQty: qty, ...extra }),
});

test('sequences jobs per machine with sequential start/finish + changeover gap', () => {
  const s = buildDaySchedule({ plans: [mkPlan('CP-001', 1000), mkPlan('CP-002', 1500)], date: '2026-06-24', shiftStartHour: 8, shiftHours: 8 });
  const bun = s.machines.bunching;
  expect(bun.jobs).toHaveLength(2);
  expect(bun.jobs[0].startTime).toBe('8:00 AM');
  expect(bun.jobs[1].startMin).toBeGreaterThan(bun.jobs[0].finishMin); // changeover gap
  expect(bun.summary.changeoverHours).toBeGreaterThan(0);
});

test('shift capacity bar: planned + changeover + buffer == available when not overbooked', () => {
  const s = buildDaySchedule({ plans: [mkPlan('CP-001', 500)], shiftHours: 8 });
  const sm = s.machines.bunching.summary;
  expect(sm.availableHours).toBe(8);
  expect(sm.overbooked).toBe(false);
  expect(sm.plannedHours + sm.changeoverHours + sm.bufferHours).toBeCloseTo(8, 1);
});

test('overbooking detected + surfaced as a bottleneck', () => {
  const s = buildDaySchedule({ plans: [mkPlan('CP-001', 1000000)], shiftHours: 8 });
  expect(s.machines.bunching.summary.overbooked).toBe(true);
  expect(s.machines.bunching.summary.overbookedByHours).toBeGreaterThan(0);
  expect(s.management.bottlenecks.length).toBeGreaterThan(0);
});

test('core extruder produces a colour sub-sequence in run order', () => {
  const s = buildDaySchedule({ plans: [mkPlan('CP-001', 1000, { coreColours: 'Red, Black, Yellow-Green' })] });
  const job = s.machines.core.jobs[0];
  expect(job.colourSequence).toHaveLength(3);
  expect(job.colourSequence[0].colour).toBe('Red');
  expect(job.colourSequence[2].colour).toBe('Yellow-Green');
});

test('priority orders the machine queue (high runs first / NOW)', () => {
  const hi = { ...mkPlan('CP-HI', 500), priority: 'high' };
  const lo = { ...mkPlan('CP-LO', 500), priority: 'low' };
  const s = buildDaySchedule({ plans: [lo, hi], shiftHours: 8 });
  expect(s.machines.bunching.jobs[0].planNumber).toBe('CP-HI');
  expect(s.machines.bunching.queue.now.planNumber).toBe('CP-HI');
  expect(s.machines.bunching.queue.next.planNumber).toBe('CP-LO');
});

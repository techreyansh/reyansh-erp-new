import { machineDailyCapacity, poolCapacityByType, scheduleMolding } from './moldingPool';

describe('moldingPool', () => {
  test('machine daily capacity = cavities × (3600/cycle) × hours', () => {
    // 45s cycle, 2 cavities, 8h → (3600/45)*2 = 160/hr × 8 = 1280/day
    expect(machineDailyCapacity({ cycle_time_sec: 45, cavities: 2, available_hours: 8 })).toBe(1280);
  });
  test('zero/invalid cycle → 0', () => {
    expect(machineDailyCapacity({ cycle_time_sec: 0, cavities: 2, available_hours: 8 })).toBe(0);
  });
  test('pool sums by type and skips inactive machines', () => {
    const fleet = [
      { mold_type: 'inner', cycle_time_sec: 45, cavities: 2, available_hours: 8 },   // 1280
      { mold_type: 'inner', cycle_time_sec: 45, cavities: 2, available_hours: 8 },   // 1280
      { mold_type: 'outer', cycle_time_sec: 60, cavities: 1, available_hours: 8 },   // 480
      { mold_type: 'grommet', cycle_time_sec: 30, cavities: 4, available_hours: 8, is_active: false }, // skipped
    ];
    const cap = poolCapacityByType(fleet);
    expect(cap.inner).toBe(2560);
    expect(cap.outer).toBe(480);
    expect(cap.grommet).toBe(0);
  });
});

describe('scheduleMolding', () => {
  const fleet = [
    { machine_code: 'IM-1', mold_type: 'inner', cycle_time_sec: 45, cavities: 2, available_hours: 8 }, // 160/hr
    { machine_code: 'IM-2', mold_type: 'inner', cycle_time_sec: 45, cavities: 2, available_hours: 8 }, // 160/hr
    { machine_code: 'OM-1', mold_type: 'outer', cycle_time_sec: 60, cavities: 1, available_hours: 8 }, // 60/hr
  ];

  test('splits a type’s demand evenly across identical machines (balanced finish)', () => {
    const rows = scheduleMolding(fleet, { inner: 2000, outer: 0, grommet: 0 }, 9);
    const inner = rows.filter((r) => r.type === 'inner');
    expect(inner).toHaveLength(2);
    expect(inner[0].assignedQty).toBe(1000);
    expect(inner[1].assignedQty).toBe(1000);
    // 1000 / 160/hr = 6.25h → finish at 15.25
    expect(inner[0].finishHour).toBeCloseTo(15.25, 1);
  });

  test('utilization = run hours / available, capped at 100', () => {
    const rows = scheduleMolding(fleet, { outer: 480, inner: 0, grommet: 0 }, 9);
    const om = rows.find((r) => r.type === 'outer');
    expect(om.runHours).toBeCloseTo(8, 1); // 480 / 60 = 8h
    expect(om.utilization).toBe(100);
  });

  test('zero demand → machines idle, not scheduled work', () => {
    const rows = scheduleMolding(fleet, {}, 9);
    expect(rows.every((r) => r.assignedQty === 0 && r.utilization === 0)).toBe(true);
  });
});

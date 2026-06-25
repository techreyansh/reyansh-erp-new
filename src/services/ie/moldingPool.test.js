import { machineDailyCapacity, poolCapacityByType } from './moldingPool';

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

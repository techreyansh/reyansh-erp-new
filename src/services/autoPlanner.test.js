import { moldingPoolPerHour, buildWorkingDays, autoPlan } from './autoPlanner';

describe('moldingPoolPerHour', () => {
  test('sums active molds: cavities x (3600/cycle)', () => {
    // 2 cav @ 36s = 200/hr; 4 cav @ 72s = 200/hr -> 400/hr
    const molds = [
      { status: 'active', cavity_count: 2, cycle_time_sec: 36 },
      { status: 'active', cavity_count: 4, cycle_time_sec: 72 },
    ];
    expect(moldingPoolPerHour(molds)).toBe(400);
  });

  test('ignores inactive molds and zero/blank cycle times', () => {
    const molds = [
      { status: 'active', cavity_count: 2, cycle_time_sec: 36 }, // 200
      { status: 'retired', cavity_count: 8, cycle_time_sec: 10 }, // ignored
      { status: 'active', cavity_count: 2, cycle_time_sec: 0 }, // 0 (bad data)
    ];
    expect(moldingPoolPerHour(molds)).toBe(200);
  });

  test('empty pool -> 0', () => {
    expect(moldingPoolPerHour([])).toBe(0);
  });
});

describe('buildWorkingDays', () => {
  test('produces N consecutive ISO dates from start', () => {
    const days = buildWorkingDays('2026-06-25', 3, { skipSundays: false });
    expect(days).toEqual(['2026-06-25', '2026-06-26', '2026-06-27']);
  });

  test('skips Sundays when asked', () => {
    // 2026-06-28 is a Sunday
    const days = buildWorkingDays('2026-06-27', 3, { skipSundays: true });
    expect(days).toEqual(['2026-06-27', '2026-06-29', '2026-06-30']);
  });
});

describe('autoPlan', () => {
  const days = ['2026-06-25', '2026-06-26', '2026-06-27'];

  test('a demand that fits in one day -> one row, no late', () => {
    const demands = [
      { id: 'd1', product_id: 'p1', product_name: 'PC 1.5m', qty: 500, planned_qty: 0, required_date: '2026-06-26', priority: 'normal' },
    ];
    const r = autoPlan({ demands, poolPerDay: 1000, workingDays: days });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ demand_id: 'd1', plan_date: '2026-06-25', planned_qty: 500, late: false });
    expect(r.perDay[0]).toMatchObject({ date: '2026-06-25', used: 500, capacity: 1000 });
    expect(r.lateCount).toBe(0);
    expect(r.unplanned).toBe(0);
  });

  test('splits a demand across consecutive days when it exceeds the daily pool', () => {
    const demands = [
      { id: 'd1', product_id: 'p1', product_name: 'PC', qty: 2500, planned_qty: 0, required_date: '2026-06-30', priority: 'normal' },
    ];
    const r = autoPlan({ demands, poolPerDay: 1000, workingDays: days });
    expect(r.rows.map((x) => [x.plan_date, x.planned_qty])).toEqual([
      ['2026-06-25', 1000],
      ['2026-06-26', 1000],
      ['2026-06-27', 500],
    ]);
    // never exceeds capacity on any day
    r.perDay.forEach((d) => expect(d.used).toBeLessThanOrEqual(d.capacity));
  });

  test('due-date order: earlier required_date is scheduled into the earliest day', () => {
    const demands = [
      { id: 'late', product_id: 'p1', product_name: 'B', qty: 1000, planned_qty: 0, required_date: '2026-06-29', priority: 'normal' },
      { id: 'soon', product_id: 'p2', product_name: 'A', qty: 1000, planned_qty: 0, required_date: '2026-06-25', priority: 'normal' },
    ];
    const r = autoPlan({ demands, poolPerDay: 1000, workingDays: days });
    const soonRow = r.rows.find((x) => x.demand_id === 'soon');
    expect(soonRow.plan_date).toBe('2026-06-25'); // earliest due wins day 1
  });

  test('flags late when the chunk lands after required_date', () => {
    const demands = [
      { id: 'd1', product_id: 'p1', product_name: 'PC', qty: 3000, planned_qty: 0, required_date: '2026-06-25', priority: 'high' },
    ];
    const r = autoPlan({ demands, poolPerDay: 1000, workingDays: days });
    // day1 ok, day2 + day3 are after the 06-25 due date -> late chunks
    expect(r.rows[0].late).toBe(false);
    expect(r.rows[1].late).toBe(true);
    expect(r.rows[2].late).toBe(true);
    expect(r.lateCount).toBe(1); // one distinct demand is late
  });

  test('skips demands already fully planned', () => {
    const demands = [
      { id: 'done', product_id: 'p1', product_name: 'X', qty: 500, planned_qty: 500, required_date: '2026-06-26', priority: 'normal' },
      { id: 'open', product_id: 'p2', product_name: 'Y', qty: 300, planned_qty: 0, required_date: '2026-06-26', priority: 'normal' },
    ];
    const r = autoPlan({ demands, poolPerDay: 1000, workingDays: days });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].demand_id).toBe('open');
  });

  test('counts unplanned when horizon pool is exhausted', () => {
    const demands = [
      { id: 'big', product_id: 'p1', product_name: 'Z', qty: 5000, planned_qty: 0, required_date: '2026-06-30', priority: 'normal' },
    ];
    const r = autoPlan({ demands, poolPerDay: 1000, workingDays: days }); // 3 days x 1000 = 3000 cap
    const allocated = r.rows.reduce((s, x) => s + x.planned_qty, 0);
    expect(allocated).toBe(3000);
    expect(r.unplanned).toBe(2000);
  });
});

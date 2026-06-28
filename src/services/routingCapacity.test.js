import { resolveStandard, standardRatePerHour, lineCapacity, forwardLine, operatorsFor } from './routingCapacity';

const DEFAULT = { default_cycle_sec: 60, default_oee: 1, constraint_type: 'labour' };

describe('resolveStandard — fallback chain routing -> mold -> process default', () => {
  test('routing values win over the mold', () => {
    const op = { cycle_time_sec: 20, cavities: 4, oee: 0.9, constraint_type: 'machine' };
    const mold = { cycle_time_sec: 30, cavity_count: 2 };
    const r = resolveStandard(op, mold, DEFAULT);
    expect(r.cycle).toBe(20);
    expect(r.cavities).toBe(4);
    expect(r.oee).toBeCloseTo(0.9);
    expect(r.constraintType).toBe('machine');
  });

  test('molding step with no routing cycle inherits the mold (H2: never copy per-piece time)', () => {
    const op = { constraint_type: 'machine', cycle_time_sec: null, cavities: null };
    const mold = { cycle_time_sec: 18, cavity_count: 6 };
    const r = resolveStandard(op, mold, DEFAULT);
    expect(r.cycle).toBe(18);
    expect(r.cavities).toBe(6);
    expect(r.outputPerCycle).toBe(6); // defaults from resolved cavities
  });

  test('falls back to process default cycle when neither routing nor mold has one', () => {
    const r = resolveStandard({ constraint_type: 'labour' }, null, DEFAULT);
    expect(r.cycle).toBe(60);
    expect(r.cavities).toBe(1);
  });
});

describe('guards (autoplan eng M1) — degenerate inputs never produce NaN/Infinity', () => {
  test('cycle <= 0 marks the op invalid (no divide-by-zero)', () => {
    const r = resolveStandard({ cycle_time_sec: 0 }, null, { ...DEFAULT, default_cycle_sec: 0 });
    expect(r.valid).toBe(false);
    expect(Number.isFinite(standardRatePerHour(r))).toBe(true);
    expect(standardRatePerHour(r)).toBe(0);
  });

  test('scrap_pct >= 1 is clamped below 1 (no divide-by-zero on input inflation)', () => {
    const r = resolveStandard({ cycle_time_sec: 36, cavities: 1, oee: 1, scrap_pct: 1 }, null, DEFAULT);
    expect(r.scrapPct).toBeLessThan(1);
    expect(r.scrapPct).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(standardRatePerHour(r))).toBe(true);
  });

  test('min_operators > max_operators is corrected, not propagated', () => {
    const r = resolveStandard({ cycle_time_sec: 30, min_operators: 5, max_operators: 2 }, null, DEFAULT);
    expect(r.minOps).toBeLessThanOrEqual(r.maxOps);
  });

  test('oee clamps into (0,1]', () => {
    expect(resolveStandard({ cycle_time_sec: 30, oee: 5 }, null, DEFAULT).oee).toBeLessThanOrEqual(1);
    expect(resolveStandard({ cycle_time_sec: 30, oee: 0 }, null, DEFAULT).oee).toBeGreaterThan(0);
  });
});

describe('standardRatePerHour — cavities-aware (the core fix)', () => {
  test('Part A: 24s, 2 cavities -> 300/hr; Part B: 18s, 6 cavities -> 1200/hr', () => {
    const a = resolveStandard({ constraint_type: 'machine', cycle_time_sec: 24, cavities: 2, oee: 1 }, null, DEFAULT);
    const b = resolveStandard({ constraint_type: 'machine', cycle_time_sec: 18, cavities: 6, oee: 1 }, null, DEFAULT);
    expect(standardRatePerHour(a)).toBe(300);
    expect(standardRatePerHour(b)).toBe(1200);
  });

  test('labour op rate ignores cavities (one piece per cycle per operator)', () => {
    const r = resolveStandard({ constraint_type: 'labour', cycle_time_sec: 30, oee: 1 }, null, DEFAULT);
    expect(standardRatePerHour(r)).toBe(120); // 3600/30
  });

  test('scrap reduces good-output rate', () => {
    const r = resolveStandard({ constraint_type: 'labour', cycle_time_sec: 36, oee: 1, scrap_pct: 0.1 }, null, DEFAULT);
    expect(standardRatePerHour(r)).toBeCloseTo(100 * 0.9); // 3600/36=100, x0.9
  });

  test('oee derates the rate', () => {
    const r = resolveStandard({ constraint_type: 'machine', cycle_time_sec: 24, cavities: 2, oee: 0.5 }, null, DEFAULT);
    expect(standardRatePerHour(r)).toBe(150); // 300 x 0.5
  });
});

describe('lineCapacity — achievable UPH + bottleneck (design: hero result)', () => {
  const ops = [
    { key: 'inner', constraint_type: 'machine', cycle_time_sec: 24, cavities: 2, oee: 1, parallel_machines: 1 }, // 300
    { key: 'crimp', constraint_type: 'labour', cycle_time_sec: 20, oee: 1 }, // 180/op (elastic)
    { key: 'pack', constraint_type: 'labour', cycle_time_sec: 30, oee: 1 }, // 120/op (elastic)
  ];

  test('achievable line UPH is the slowest machine-constrained op', () => {
    const r = lineCapacity(ops.map((o) => resolveStandard(o, null, DEFAULT)));
    expect(r.achievableUph).toBe(300);
    expect(r.bottleneck.constraintType).toBe('machine');
  });

  test('two parallel machines double the molding throughput', () => {
    const two = [{ ...ops[0], parallel_machines: 2 }, ops[1], ops[2]];
    const r = lineCapacity(two.map((o) => resolveStandard(o, null, DEFAULT)));
    expect(r.achievableUph).toBe(600);
  });

  test('labour-only line is capped by the slowest single-operator station', () => {
    const labourOnly = [ops[1], ops[2]].map((o) => resolveStandard(o, null, DEFAULT));
    const r = lineCapacity(labourOnly);
    expect(r.achievableUph).toBe(120); // slowest labour op at 1 operator
  });
});

describe('operatorsFor — labour stations sized to hold the line', () => {
  test('operators = ceil(lineUph / per-operator rate), clamped to [min,max]', () => {
    const pack = resolveStandard({ constraint_type: 'labour', cycle_time_sec: 30, oee: 1, min_operators: 1, max_operators: 4 }, null, DEFAULT);
    // line at 300, pack does 120/op -> need ceil(300/120)=3 operators
    expect(operatorsFor(pack, 300)).toBe(3);
  });

  test('respects max_operators cap', () => {
    const pack = resolveStandard({ constraint_type: 'labour', cycle_time_sec: 30, oee: 1, min_operators: 1, max_operators: 2 }, null, DEFAULT);
    expect(operatorsFor(pack, 300)).toBe(2); // wants 3, capped at 2
  });

  test('parallel_allowed=false → at most ONE operator regardless of demand (bug fix)', () => {
    const weld = resolveStandard({ constraint_type: 'labour', cycle_time_sec: 30, oee: 1, min_operators: 1, max_operators: 4, parallel_allowed: false }, null, DEFAULT);
    expect(weld.parallelAllowed).toBe(false);
    expect(operatorsFor(weld, 300)).toBe(1); // would need 3, but no parallel work allowed
  });

  test('parallel_allowed defaults true → unchanged behaviour', () => {
    const r = resolveStandard({ constraint_type: 'labour', cycle_time_sec: 30, oee: 1, max_operators: 4 }, null, DEFAULT);
    expect(r.parallelAllowed).toBe(true);
    expect(operatorsFor(r, 300)).toBe(3);
  });
});

describe('lineCapacity — mixed labour/machine bottleneck (bug fix)', () => {
  test('a labour op that cannot reach the machine rate even fully staffed caps the line', () => {
    // inner machine 300/hr; weld is labour, single-op 120/hr, capped at 2 operators
    // and NOT parallel-allowed → max labour cap = 120, below the 300 machine rate.
    const ops = [
      { key: 'inner', constraint_type: 'machine', cycle_time_sec: 24, cavities: 2, oee: 1, parallel_machines: 1 }, // 300
      { key: 'weld', constraint_type: 'labour', cycle_time_sec: 30, oee: 1, max_operators: 2, parallel_allowed: false }, // 120, can't scale
    ].map((o) => resolveStandard(o, null, DEFAULT));
    const r = lineCapacity(ops);
    expect(r.bottleneck.key).toBe('weld');
    expect(r.achievableUph).toBe(120); // not 300 — the maxed labour station is the real cap
  });

  test('labour op with ample max operators does NOT cap a machine line (no regression)', () => {
    const ops = [
      { key: 'inner', constraint_type: 'machine', cycle_time_sec: 24, cavities: 2, oee: 1, parallel_machines: 1 }, // 300
      { key: 'crimp', constraint_type: 'labour', cycle_time_sec: 20, oee: 1, max_operators: 99 }, // 180/op × 99 ≫ 300
    ].map((o) => resolveStandard(o, null, DEFAULT));
    const r = lineCapacity(ops);
    expect(r.bottleneck.key).toBe('inner');
    expect(r.achievableUph).toBe(300);
  });

  test('all-invalid line → 0 UPH, null bottleneck (null-guard)', () => {
    const ops = [{ constraint_type: 'labour', cycle_time_sec: 0 }, { constraint_type: 'machine', cycle_time_sec: null }]
      .map((o) => resolveStandard(o, null, { default_cycle_sec: null }));
    const r = lineCapacity(ops);
    expect(r.achievableUph).toBe(0);
    expect(r.bottleneck).toBeNull();
  });
});

describe('forwardLine — resources deployed -> achievable line UPH + bottleneck', () => {
  const DEF = { default_cycle_sec: 60, default_oee: 1, constraint_type: 'labour' };
  // The sheet's C10041 assembly bottleneck: fiberglass sleeve 30s/pc = 120/hr at OEE 1.
  const sleeve = (over = {}) => resolveStandard({ key: 'sleeve', constraint_type: 'labour', cycle_time_sec: 30, oee: 1, max_operators: 9, ...over }, null, DEF);
  const strip = resolveStandard({ key: 'strip', constraint_type: 'labour', cycle_time_sec: 3.75, oee: 1, max_operators: 9 }, null, DEF); // 960/op

  test('one station each → line gated by the slowest single station', () => {
    const ops = [strip, sleeve()];
    const r = forwardLine(ops, { strip: 1, sleeve: 1 });
    expect(r.bottleneck.key).toBe('sleeve');
    expect(r.achievableUph).toBe(120);
    expect(r.rows.find((x) => x.key === 'sleeve').bottleneck).toBe(true);
  });

  test('3 parallel sleeve stations lift the line off the sleeve (120 → 360)', () => {
    const r = forwardLine([strip, sleeve()], { strip: 1, sleeve: 3 });
    expect(r.achievableUph).toBe(360); // 120 × 3; strip (960) no longer slowest
    expect(r.bottleneck.key).toBe('sleeve');
  });

  test('missing/zero resource defaults to 1 station (never silently zeroes the line)', () => {
    const r = forwardLine([strip, sleeve()], { strip: 5 }); // sleeve unspecified
    expect(r.rows.find((x) => x.key === 'sleeve').count).toBe(1);
    expect(r.achievableUph).toBe(120);
  });

  test('machine op scales by machines deployed (cavity-aware single rate × count)', () => {
    // C10052 outer: 30s shot, 2-cavity = 240/hr per machine at OEE 1.
    const outer = resolveStandard({ key: 'outer', constraint_type: 'machine', cycle_time_sec: 30, cavities: 2, oee: 1 }, null, DEF);
    const r = forwardLine([outer], { outer: 2 });
    expect(r.rows[0].perUnit).toBe(240);
    expect(r.achievableUph).toBe(480); // two machines
  });

  test('invalid ops are skipped; empty/all-invalid line → 0 UPH, null bottleneck', () => {
    expect(forwardLine([], {})).toEqual({ achievableUph: 0, bottleneck: null, rows: [] });
    const bad = resolveStandard({ key: 'x', cycle_time_sec: 0 }, null, { default_cycle_sec: 0 });
    const r = forwardLine([bad], { x: 3 });
    expect(r.achievableUph).toBe(0);
    expect(r.bottleneck).toBeNull();
  });
});

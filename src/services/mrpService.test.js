import { aggregateMrp } from './mrpService';

describe('aggregateMrp', () => {
  test('rolls up material per piece × order qty, across costings', () => {
    const lines = [
      { qty: 500, costing_version_id: 'c1' }, // c1 basis 1 → 500×
      { qty: 200, costing_version_id: 'c2' }, // c2 basis 100 → 2×
    ];
    const versions = [{ id: 'c1', qty_basis: 1 }, { id: 'c2', qty_basis: 100 }];
    const matLines = [
      { costing_id: 'c1', material_code: 'COPPER', category: 'Copper', qty: 0.4, uom: 'kg' },
      { costing_id: 'c1', material_code: 'PIN_6A', category: 'Pin', qty: 1, uom: 'pc' },
      { costing_id: 'c2', material_code: 'COPPER', category: 'Copper', qty: 50, uom: 'kg' }, // per 100 pcs
    ];
    const out = aggregateMrp(lines, versions, matLines);
    const copper = out.find((m) => m.code === 'COPPER');
    // c1: 0.4 × 500 = 200 ; c2: 50 × (200/100)=2 → 50×2 = 100 ; total 300
    expect(copper.qty).toBe(300);
    const pin = out.find((m) => m.code === 'PIN_6A');
    expect(pin.qty).toBe(500); // 1 × 500
    expect(out[0].code).toBe('PIN_6A'); // sorted by qty desc (500 > 300)
  });

  test('empty input safe; lines without costing ignored', () => {
    expect(aggregateMrp([], [], [])).toEqual([]);
    expect(aggregateMrp([{ qty: 10, costing_version_id: null }], [], [])).toEqual([]);
  });
});

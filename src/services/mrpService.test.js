import { aggregateMrp, netRequirements } from './mrpService';

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

describe('netRequirements', () => {
  const materials = [
    { code: 'PIN_6A', name: '6A pin/plug', uom: 'pc', qty: 500 },
    { code: 'COPPER', name: 'Copper conductor', uom: 'kg', qty: 300 },
    { code: 'PVC_INS', name: 'PVC insulation', uom: 'kg', qty: 80 },
  ];
  const stock = [
    { itemCode: 'PIN_6A', itemName: '6A Pin', currentStock: '1200', reorderPoint: '500', unit: 'pc' }, // code match, enough
    { itemCode: 'CU01', itemName: 'Copper conductor', currentStock: '100', reorderPoint: '50', unit: 'kg' }, // name match, short
  ];

  test('nets by code, by name, and flags unmatched', () => {
    const out = netRequirements(materials, stock);
    const pin = out.find((m) => m.code === 'PIN_6A');
    expect(pin.onHand).toBe(1200);
    expect(pin.shortfall).toBe(0);
    expect(pin.status).toBe('ok');

    const cu = out.find((m) => m.code === 'COPPER'); // matched by normalized name
    expect(cu.onHand).toBe(100);
    expect(cu.shortfall).toBe(200); // 300 - 100
    expect(cu.status).toBe('short');

    const pvc = out.find((m) => m.code === 'PVC_INS'); // no stock record
    expect(pvc.onHand).toBeNull();
    expect(pvc.shortfall).toBe(80);
    expect(pvc.status).toBe('unmatched');
  });

  test('no stock → everything unmatched, shortfall = full qty', () => {
    const out = netRequirements(materials, []);
    expect(out.every((m) => m.status === 'unmatched')).toBe(true);
    expect(out.find((m) => m.code === 'COPPER').shortfall).toBe(300);
  });
});

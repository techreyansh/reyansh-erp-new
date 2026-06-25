import { buildPrLines } from './purchaseRequisitionService';

const materials = [
  { code: 'PIN_6A', name: '6A pin', uom: 'pc', qty: 500, onHand: 1200, shortfall: 0, status: 'ok' },
  { code: 'COPPER', name: 'Copper', uom: 'kg', qty: 300, onHand: 100, shortfall: 200, status: 'short', stockItem: { code: 'CU01' } },
  { code: 'PVC_INS', name: 'PVC insulation', uom: 'kg', qty: 80, onHand: null, shortfall: 80, status: 'unmatched' },
];

test('buildPrLines includes only short/unmatched with shortfall>0', () => {
  const lines = buildPrLines(materials, { COPPER: 745 });
  expect(lines.map((l) => l.material_code)).toEqual(['COPPER', 'PVC_INS']); // PIN_6A (ok) excluded
});

test('order_qty defaults to shortfall; est_amount = qty × rate', () => {
  const lines = buildPrLines(materials, { COPPER: 745 });
  const cu = lines.find((l) => l.material_code === 'COPPER');
  expect(cu.order_qty).toBe(200);
  expect(cu.est_rate).toBe(745);
  expect(cu.est_amount).toBe(149000); // 200 × 745
  expect(cu.stock_item_code).toBe('CU01');
  const pvc = lines.find((l) => l.material_code === 'PVC_INS');
  expect(pvc.on_hand).toBeNull();
  expect(pvc.est_amount).toBe(0); // no rate
});

test('empty when nothing short', () => {
  expect(buildPrLines([materials[0]], {})).toEqual([]);
});

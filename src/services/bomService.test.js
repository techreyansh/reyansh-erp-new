import { bomMaterialLines, matchRateCode, bomToCostingLines } from './bomService';

const rates = [
  { material_code: 'COPPER', material_name: 'Copper conductor', rate: 745 },
  { material_code: 'PVC_INS', material_name: 'PVC insulation compound', rate: 110 },
  { material_code: 'PIN_6A', material_name: '6A pin/plug', rate: 14 },
  { material_code: 'PACKING', material_name: 'Packing material', rate: 12 },
];

const bom = {
  cableMaterials: [
    { rawMaterial: 'Copper Wire 0.5sqmm', units: 'kg', qtyPerPc: 0.42 },
    { rawMaterial: 'Core PVC Compound', units: 'kg', qtyPerPc: 0.18 },
  ],
  mouldingMaterials: [
    { rawMaterial: '3 Pin 6A Plug', units: 'pc', qtyPerPc: 1 },
    { rawMaterial: 'Packing Carton', units: 'set', qtyPerPc: 1 },
  ],
};

describe('bomService', () => {
  test('bomMaterialLines flattens cable + moulding arrays', () => {
    const lines = bomMaterialLines(bom);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ rawMaterial: 'Copper Wire 0.5sqmm', units: 'kg', qty: 0.42 });
    expect(bomMaterialLines({})).toEqual([]);
  });

  test('matchRateCode maps names to rate codes by keyword', () => {
    expect(matchRateCode('Copper Wire 0.5sqmm', rates)).toBe('COPPER');
    expect(matchRateCode('Core PVC Compound', rates)).toBe('PVC_INS');
    expect(matchRateCode('3 Pin 6A Plug', rates)).toBe('PIN_6A');
    expect(matchRateCode('Packing Carton', rates)).toBe('PACKING');
    expect(matchRateCode('Unknownium', rates)).toBeNull();
  });

  test('bomToCostingLines builds material lines with matched rates', () => {
    const lines = bomToCostingLines(bom, rates);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ section: 'material', material_code: 'COPPER', rate: 745, qty: 0.42 });
    expect(lines.find((l) => l.material_code === 'PIN_6A').rate).toBe(14);
  });
});

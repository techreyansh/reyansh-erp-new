import { toBase, fromBase } from './inventoryUomBinService';

describe('UoM converters', () => {
  test('toBase: 1 roll = 100 m → 3 rolls = 300 m', () => {
    expect(toBase(3, 100)).toBe(300);
  });
  test('fromBase: 300 m → 3 rolls', () => {
    expect(fromBase(300, 100)).toBe(3);
  });
  test('round-trips', () => {
    expect(fromBase(toBase(5, 25), 25)).toBe(5);
  });
  test('guards: missing/zero factor → base unchanged / 0', () => {
    expect(toBase(5, 0)).toBe(5);      // factor 0 falls back to 1
    expect(fromBase(5, 0)).toBe(0);    // can't divide by 0 → 0
    expect(toBase('x', 10)).toBe(0);
  });
});

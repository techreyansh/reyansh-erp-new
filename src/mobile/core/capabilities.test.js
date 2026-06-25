import { hasCap, hasAllCaps, normalizeCaps } from './capabilities';
import { newKey } from './api/idempotency';

describe('capabilities', () => {
  it('normalizes array, {capabilities:[]}, and empty payloads', () => {
    expect(normalizeCaps(['a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeCaps({ capabilities: ['x'] })).toEqual(['x']);
    expect(normalizeCaps(null)).toEqual([]);
  });

  it('hasCap is closed-by-default but allows uncapped screens', () => {
    expect(hasCap(['demo.submit'], 'demo.submit')).toBe(true);
    expect(hasCap(['demo.submit'], 'other')).toBe(false);
    expect(hasCap([], 'demo.submit')).toBe(false);
    expect(hasCap([], '')).toBe(true); // no requirement → allowed
  });

  it('hasAllCaps requires every key', () => {
    expect(hasAllCaps(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(hasAllCaps(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('idempotency.newKey', () => {
  it('produces unique, non-empty keys', () => {
    const a = newKey();
    const b = newKey();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
  });
});

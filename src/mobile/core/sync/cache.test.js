import { isStale, DEFAULT_TTL_MS } from './cache';

describe('cache.isStale', () => {
  it('treats a missing timestamp as stale', () => {
    expect(isStale(null)).toBe(true);
    expect(isStale(undefined)).toBe(true);
  });

  it('is fresh within the ttl window and stale beyond it', () => {
    const now = 1_000_000;
    const ttl = 10_000;
    expect(isStale(now - 5_000, ttl, now)).toBe(false); // 5s old, ttl 10s
    expect(isStale(now - 15_000, ttl, now)).toBe(true); // 15s old, ttl 10s
  });

  it('never goes stale when ttl is zero/negative (permanent cache)', () => {
    const now = 1_000_000;
    expect(isStale(now - 99_999_999, 0, now)).toBe(false);
    expect(isStale(now - 99_999_999, -1, now)).toBe(false);
  });

  it('uses a sane default ttl', () => {
    expect(DEFAULT_TTL_MS).toBeGreaterThan(0);
  });
});

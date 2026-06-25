import {
  nextBackoffMs,
  isExhausted,
  shouldDedupe,
  makeIntent,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_ATTEMPTS,
} from './outboxPolicy';

describe('outboxPolicy.nextBackoffMs', () => {
  it('starts at the base delay and doubles per attempt', () => {
    expect(nextBackoffMs(0)).toBe(BASE_BACKOFF_MS);
    expect(nextBackoffMs(1)).toBe(BASE_BACKOFF_MS * 2);
    expect(nextBackoffMs(2)).toBe(BASE_BACKOFF_MS * 4);
  });

  it('caps the delay at MAX_BACKOFF_MS', () => {
    expect(nextBackoffMs(100)).toBe(MAX_BACKOFF_MS);
  });

  it('treats negative/garbage attempts as zero', () => {
    expect(nextBackoffMs(-5)).toBe(BASE_BACKOFF_MS);
    expect(nextBackoffMs(undefined)).toBe(BASE_BACKOFF_MS);
  });
});

describe('outboxPolicy.isExhausted', () => {
  it('is false below the cap and true at/above it', () => {
    expect(isExhausted(MAX_ATTEMPTS - 1)).toBe(false);
    expect(isExhausted(MAX_ATTEMPTS)).toBe(true);
    expect(isExhausted(MAX_ATTEMPTS + 3)).toBe(true);
  });
});

describe('outboxPolicy.shouldDedupe', () => {
  it('detects a duplicate key against a Set and an Array', () => {
    const intent = { idempotencyKey: 'abc' };
    expect(shouldDedupe(intent, new Set(['abc']))).toBe(true);
    expect(shouldDedupe(intent, ['x', 'abc'])).toBe(true);
  });

  it('returns false for an unseen key or a keyless intent', () => {
    expect(shouldDedupe({ idempotencyKey: 'new' }, new Set(['abc']))).toBe(false);
    expect(shouldDedupe({}, new Set(['abc']))).toBe(false);
  });
});

describe('outboxPolicy.makeIntent', () => {
  it('normalizes a raw submit into a well-formed intent', () => {
    const i = makeIntent({ idempotencyKey: 1, rpc: 'mobile_ping', args: { a: 1 }, createdAt: 10 });
    expect(i).toEqual({
      idempotencyKey: '1',
      rpc: 'mobile_ping',
      args: { a: 1 },
      entity: null,
      createdAt: 10,
    });
  });
});

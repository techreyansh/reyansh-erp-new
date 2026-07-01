import {
  validateBusinessHours,
  delayKind,
  serializeDelay,
  delayLabel,
  insertAtCursor,
  computeMediaAttachDiff,
  moveItem,
} from './wizardHelpers';

describe('validateBusinessHours (Task 5 carry-forward)', () => {
  test('accepts a normal window', () => {
    expect(validateBusinessHours(9, 18)).toBeNull();
  });

  test('rejects end === start (permanently-closed window)', () => {
    expect(validateBusinessHours(9, 9)).toMatch(/later than the start/i);
  });

  test('rejects end < start', () => {
    expect(validateBusinessHours(18, 9)).toMatch(/later than the start/i);
  });

  test('rejects out-of-range hours', () => {
    expect(validateBusinessHours(-1, 18)).toMatch(/between 0 and 23/i);
    expect(validateBusinessHours(9, 24)).toMatch(/between 0 and 23/i);
  });

  test('rejects missing values', () => {
    expect(validateBusinessHours(undefined, 18)).toMatch(/required/i);
    expect(validateBusinessHours(9, undefined)).toMatch(/required/i);
    expect(validateBusinessHours('abc', 18)).toMatch(/required/i);
  });
});

describe('delayKind / serializeDelay / delayLabel', () => {
  test('delayKind reads immediate vs after_days off a step row', () => {
    expect(delayKind({ delay_type: 'immediate' })).toBe('immediate');
    expect(delayKind({ delay_type: 'after_days', delay_days: 4 })).toBe('after_days');
    expect(delayKind(null)).toBe('immediate');
  });

  test('serializeDelay(immediate) always zeroes delay_days', () => {
    expect(serializeDelay('immediate', 7)).toEqual({ delay_type: 'immediate', delay_days: 0 });
  });

  test('serializeDelay(after_days) accepts arbitrary non-preset counts', () => {
    expect(serializeDelay('after_days', 4)).toEqual({ delay_type: 'after_days', delay_days: 4 });
    expect(serializeDelay('after_days', 7)).toEqual({ delay_type: 'after_days', delay_days: 7 });
    expect(serializeDelay('after_days', 30)).toEqual({ delay_type: 'after_days', delay_days: 30 });
  });

  test('serializeDelay(after_days) floors invalid/non-positive input to 1', () => {
    expect(serializeDelay('after_days', 0)).toEqual({ delay_type: 'after_days', delay_days: 1 });
    expect(serializeDelay('after_days', -3)).toEqual({ delay_type: 'after_days', delay_days: 1 });
    expect(serializeDelay('after_days', 'abc')).toEqual({ delay_type: 'after_days', delay_days: 1 });
    expect(serializeDelay('after_days', 2.9)).toEqual({ delay_type: 'after_days', delay_days: 2 });
  });

  test('delayLabel renders a human summary', () => {
    expect(delayLabel({ delay_type: 'immediate' })).toBe('Immediately');
    expect(delayLabel({ delay_type: 'after_days', delay_days: 1 })).toBe('After 1 day');
    expect(delayLabel({ delay_type: 'after_days', delay_days: 4 })).toBe('After 4 days');
  });
});

describe('insertAtCursor', () => {
  test('inserts a variable token at the cursor position', () => {
    const { text, cursor } = insertAtCursor('Hi , welcome!', 3, 3, '{{CustomerName}}');
    expect(text).toBe('Hi {{CustomerName}}, welcome!');
    expect(cursor).toBe(3 + '{{CustomerName}}'.length);
  });

  test('replaces a selected range rather than just inserting', () => {
    const { text } = insertAtCursor('Hi NAME, welcome!', 3, 7, '{{CustomerName}}');
    expect(text).toBe('Hi {{CustomerName}}, welcome!');
  });

  test('appends to the end when no selection info is given', () => {
    const { text, cursor } = insertAtCursor('Hello', undefined, undefined, '!');
    expect(text).toBe('Hello!');
    expect(cursor).toBe(6);
  });
});

describe('computeMediaAttachDiff', () => {
  const media = [
    { id: 'm1', step_id: 'stepA' },
    { id: 'm2', step_id: 'stepA' },
    { id: 'm3', step_id: null },
    { id: 'm4', step_id: 'stepB' },
  ];

  test('attaches newly-selected media not already on this step', () => {
    const { toAttach, toDetach } = computeMediaAttachDiff(media, ['m1', 'm3'], 'stepA');
    expect(toAttach.sort()).toEqual(['m3']);
    expect(toDetach.sort()).toEqual(['m2']);
  });

  test('no-op when selection already matches current attachment', () => {
    const { toAttach, toDetach } = computeMediaAttachDiff(media, ['m1', 'm2'], 'stepA');
    expect(toAttach).toEqual([]);
    expect(toDetach).toEqual([]);
  });

  test('unrelated (other-step) media is left untouched', () => {
    const { toAttach, toDetach } = computeMediaAttachDiff(media, [], 'stepA');
    expect(toAttach).toEqual([]);
    expect(toDetach.sort()).toEqual(['m1', 'm2']);
  });
});

describe('moveItem', () => {
  test('moves an element earlier in the array', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  test('moves an element later in the array', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  test('out-of-range indices are a no-op', () => {
    const arr = ['a', 'b'];
    expect(moveItem(arr, -1, 1)).toEqual(['a', 'b']);
    expect(moveItem(arr, 0, 5)).toEqual(['a', 'b']);
  });
});

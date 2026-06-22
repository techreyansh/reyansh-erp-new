import { dayCount, summarizeLeave } from './leaveService';

describe('leave calculations', () => {
  test('dayCount is inclusive and guards bad ranges', () => {
    expect(dayCount('2026-06-01', '2026-06-01')).toBe(1);
    expect(dayCount('2026-06-01', '2026-06-05')).toBe(5);
    expect(dayCount('2026-06-05', '2026-06-01')).toBe(0); // end before start
    expect(dayCount('', '2026-06-01')).toBe(0);
  });

  test('summarizeLeave counts only approved days in the current year', () => {
    const yr = new Date().getFullYear();
    const rows = [
      { leave_type: 'casual', status: 'approved', start_date: `${yr}-03-01`, days: 2 },
      { leave_type: 'casual', status: 'approved', start_date: `${yr}-05-10`, days: 1 },
      { leave_type: 'casual', status: 'pending', start_date: `${yr}-06-01`, days: 5 },   // not counted (pending)
      { leave_type: 'sick', status: 'approved', start_date: `${yr - 1}-12-01`, days: 3 }, // not counted (last year)
    ];
    const out = summarizeLeave(rows);
    const casual = out.find((b) => b.key === 'casual');
    expect(casual.used).toBe(3);
    expect(casual.remaining).toBe(casual.entitled - 3);
    const sick = out.find((b) => b.key === 'sick');
    expect(sick.used).toBe(0);
    const unpaid = out.find((b) => b.key === 'unpaid');
    expect(unpaid.remaining).toBeNull(); // no entitlement cap
  });
});

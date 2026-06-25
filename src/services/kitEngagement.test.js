import { scoreByCategory } from './kitEngagement';

const DAY = 86400000;
const NOW = new Date('2026-06-01T00:00:00Z').getTime();
const iso = (daysFromBase) => new Date(NOW + daysFromBase * DAY).toISOString();

const templates = [
  { id: 't1', category: 'industry_insight', name: 'Insight' },
  { id: 't2', category: 'relationship', name: 'Relationship' },
];

describe('scoreByCategory', () => {
  test('credits a response when activity follows a message within the window', () => {
    const messages = [
      { template_id: 't1', account_id: 'a1', sent_at: iso(0), direction: 'out' },   // insight → meeting 3d later
      { template_id: 't1', account_id: 'a2', sent_at: iso(0), direction: 'out' },   // insight → nothing
      { template_id: 't2', account_id: 'a3', sent_at: iso(0), direction: 'out' },   // relationship → quote 2d later
    ];
    const activities = [
      { pipeline_id: 'a1', activity_type: 'meeting', activity_at: iso(3) },
      { pipeline_id: 'a3', activity_type: 'quotation', activity_at: iso(2) },
      { pipeline_id: 'a2', activity_type: 'note', activity_at: iso(40) },           // outside window
    ];
    const out = scoreByCategory({ messages, templates, activities, windowDays: 14 });
    const insight = out.find((c) => c.category === 'industry_insight');
    const rel = out.find((c) => c.category === 'relationship');
    expect(insight.sent).toBe(2);
    expect(insight.responded).toBe(1);
    expect(insight.responseRate).toBe(50);
    expect(insight.meetings).toBe(1);
    expect(rel.responseRate).toBe(100);
    expect(rel.quotations).toBe(1);
    // sorted by responseRate desc → relationship (100) first
    expect(out[0].category).toBe('relationship');
  });

  test('inbound messages are not counted as sent; empty input safe', () => {
    expect(scoreByCategory({})).toEqual([]);
    const out = scoreByCategory({ messages: [{ template_id: 't1', account_id: 'a1', direction: 'in', sent_at: iso(0) }], templates });
    expect(out).toEqual([]); // inbound skipped
  });
});

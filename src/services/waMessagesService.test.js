import { reduceCampaignAnalytics } from './waMessagesService';

describe('reduceCampaignAnalytics', () => {
  test('empty input is safe', () => {
    expect(reduceCampaignAnalytics([])).toMatchObject({
      totalContacts: 0, totalMessages: 0, sent: 0, delivered: 0, read: 0, failed: 0, replies: 0,
      deliveryRate: 0, readRate: 0, completionRate: 0,
    });
    expect(reduceCampaignAnalytics(null)).toMatchObject({ totalMessages: 0 });
  });

  test('computes counts and rates from a mixed batch of messages', () => {
    const messages = [
      { contact_id: 'c1', status: 'read', sent_at: '2026-06-01', delivered_at: '2026-06-01', read_at: '2026-06-02' },
      { contact_id: 'c2', status: 'delivered', sent_at: '2026-06-01', delivered_at: '2026-06-01', read_at: null },
      { contact_id: 'c3', status: 'sent', sent_at: '2026-06-01', delivered_at: null, read_at: null },
      { contact_id: 'c4', status: 'failed', sent_at: null, delivered_at: null, read_at: null },
    ];
    const out = reduceCampaignAnalytics(messages);
    expect(out.totalContacts).toBe(4);
    expect(out.totalMessages).toBe(4);
    expect(out.sent).toBe(3); // c1,c2,c3 have sent_at
    expect(out.delivered).toBe(2);
    expect(out.read).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.completionRate).toBe(75); // 3 of 4 in a terminal 'sent'/'delivered'/'read' status
    expect(out.deliveryRate).toBe(66.7); // 2 delivered / 3 sent
    expect(out.readRate).toBe(33.3); // 1 read / 3 sent
  });

  test('duplicate contact_id across messages counts as one contact', () => {
    const messages = [
      { contact_id: 'c1', status: 'sent', sent_at: '2026-06-01' },
      { contact_id: 'c1', status: 'sent', sent_at: '2026-06-02' },
    ];
    expect(reduceCampaignAnalytics(messages).totalContacts).toBe(1);
  });
});

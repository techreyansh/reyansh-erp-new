import { recommendCadence, rankForOutreach } from './kitCadence';

const base = { whatsapp_enabled: true, email_enabled: true, account_type: 'prospect', engagement_score: 50 };

describe('recommendCadence', () => {
  test('live opportunity → high priority, opportunity category', () => {
    const r = recommendCadence({ ...base, prospect_stage: 'quotation_sent', days_since_touch: 4 });
    expect(r.priority).toBe(3);
    expect(r.category).toBe('opportunity');
  });

  test('dormant 90d+ → high priority re-engagement', () => {
    const r = recommendCadence({ ...base, prospect_stage: 'lead', days_since_touch: 120 });
    expect(r.priority).toBe(3);
    expect(r.category).toBe('reengagement');
  });

  test('at-risk → re-engage (medium)', () => {
    const r = recommendCadence({ ...base, prospect_stage: 'lead', days_since_touch: 12, at_risk: true });
    expect(r.priority).toBe(2);
    expect(r.category).toBe('reengagement');
  });

  test('low engagement → value touch (industry insight)', () => {
    const r = recommendCadence({ ...base, prospect_stage: 'lead', days_since_touch: 5, engagement_score: 10 });
    expect(r.category).toBe('industry_insight');
  });

  test('recently & healthily engaged → no nudge', () => {
    expect(recommendCadence({ ...base, prospect_stage: 'lead', days_since_touch: 3, engagement_score: 80 })).toBeNull();
  });

  test('no reachable channel → null', () => {
    expect(recommendCadence({ ...base, whatsapp_enabled: false, email_enabled: false, days_since_touch: 200 })).toBeNull();
  });

  test('channel falls back to email when whatsapp disabled', () => {
    const r = recommendCadence({ ...base, whatsapp_enabled: false, days_since_touch: 95 });
    expect(r.channel).toBe('email');
  });
});

describe('rankForOutreach', () => {
  test('drops healthy contacts and ranks by priority then quiet-days', () => {
    const contacts = [
      { ...base, company_name: 'Healthy', days_since_touch: 2, engagement_score: 90 },           // dropped
      { ...base, company_name: 'Dormant', prospect_stage: 'lead', days_since_touch: 100 },        // p3
      { ...base, company_name: 'Quiet', prospect_stage: 'lead', days_since_touch: 20, engagement_score: 50 }, // p1
      { ...base, company_name: 'Opp', prospect_stage: 'sample_sent', days_since_touch: 5 },       // p3
    ];
    const ranked = rankForOutreach(contacts);
    expect(ranked.map((r) => r.contact.company_name)).not.toContain('Healthy');
    expect(ranked[0].rec.priority).toBe(3);
    // among the two p3s, Dormant (100d) outranks Opp (5d)
    expect(ranked[0].contact.company_name).toBe('Dormant');
  });
});

import { evaluateProviderReadiness } from './waProviderService';

describe('evaluateProviderReadiness', () => {
  test('missing provider row', () => {
    expect(evaluateProviderReadiness(null)).toEqual({ ok: false, reason: 'Provider not found.' });
  });

  test('meta_cloud requires access_token and phone_number_id', () => {
    const base = { provider_key: 'meta_cloud', sender_number: '+919876543210', credentials: {} };
    expect(evaluateProviderReadiness(base)).toEqual({ ok: false, reason: 'Missing access_token.' });
    expect(evaluateProviderReadiness({ ...base, credentials: { access_token: 'tok' } }))
      .toEqual({ ok: false, reason: 'Missing phone_number_id.' });
    expect(evaluateProviderReadiness({ ...base, credentials: { access_token: 'tok', phone_number_id: '123' } }))
      .toEqual({ ok: true, reason: null });
  });

  test('non-meta providers just need some credentials configured', () => {
    expect(evaluateProviderReadiness({ provider_key: 'twilio', sender_number: '+1555', credentials: {} }))
      .toEqual({ ok: false, reason: 'No credentials configured for this provider.' });
    expect(evaluateProviderReadiness({ provider_key: 'twilio', sender_number: '+1555', credentials: { sid: 'x', token: 'y' } }))
      .toEqual({ ok: true, reason: null });
  });

  test('missing sender_number fails even with valid credentials', () => {
    expect(evaluateProviderReadiness({
      provider_key: 'meta_cloud',
      credentials: { access_token: 'tok', phone_number_id: '123' },
      sender_number: null,
    })).toEqual({ ok: false, reason: 'Missing sender_number.' });
  });
});

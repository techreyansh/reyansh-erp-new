import { isValidStatusTransition, PENDING_MESSAGE_STATUSES } from './waCampaignsService';

// ---------------------------------------------------------------------------
// setStatus('stopped') must cancel not-yet-sent wa_messages (Task 9). Build a
// minimal chainable mock of the supabase query builder so we can assert the
// exact update/filter calls without touching a real Supabase project.
// ---------------------------------------------------------------------------
function makeChain(result) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn(() => chain),
    single: jest.fn(() => Promise.resolve(result)),
    update: jest.fn(() => chain),
    // Chain is thenable so `await` resolves with `result` no matter which
    // method call (e.g. `.select('id')` after `.in(...)`) ends the chain.
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return chain;
}

jest.mock('../lib/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

describe('setStatus — stop cancels pending messages', () => {
  let waCampaignsService;
  let supabase;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    supabase = require('../lib/supabaseClient').supabase;
    // eslint-disable-next-line global-require
    waCampaignsService = require('./waCampaignsService').default;
  });

  test('cancelPendingMessages sets failed/error=cancelled and only touches pending statuses', async () => {
    const campaignsChain = makeChain({ data: { status: 'running' }, error: null });
    const messagesChain = makeChain({ data: [{ id: 'm1' }, { id: 'm2' }], error: null });
    supabase.from.mockImplementation((table) => (table === 'wa_messages' ? messagesChain : campaignsChain));

    const n = await waCampaignsService.cancelPendingMessages('camp-1');

    expect(n).toBe(2);
    expect(messagesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'cancelled' })
    );
    expect(messagesChain.eq).toHaveBeenCalledWith('campaign_id', 'camp-1');
    expect(messagesChain.in).toHaveBeenCalledWith('status', PENDING_MESSAGE_STATUSES);
  });

  test('setStatus("stopped") transitions the campaign then cancels its pending messages', async () => {
    const campaignsChain = makeChain({ data: { status: 'stopped' }, error: null });
    // First .single() call (read current status) resolves 'running'; second
    // (the update) resolves the stopped row.
    campaignsChain.single
      .mockResolvedValueOnce({ data: { status: 'running' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'stopped' }, error: null });
    const messagesChain = makeChain({ data: [{ id: 'm1' }], error: null });
    supabase.from.mockImplementation((table) => (table === 'wa_messages' ? messagesChain : campaignsChain));

    const result = await waCampaignsService.setStatus('camp-1', 'stopped');

    expect(result.status).toBe('stopped');
    expect(messagesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'cancelled' })
    );
  });

  test('setStatus("paused") does not touch wa_messages at all', async () => {
    const campaignsChain = makeChain({ data: { status: 'running' }, error: null });
    campaignsChain.single
      .mockResolvedValueOnce({ data: { status: 'running' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'paused' }, error: null });
    const messagesChain = makeChain({ data: [], error: null });
    supabase.from.mockImplementation((table) => (table === 'wa_messages' ? messagesChain : campaignsChain));

    await waCampaignsService.setStatus('camp-1', 'paused');

    expect(messagesChain.update).not.toHaveBeenCalled();
  });
});

describe('isValidStatusTransition', () => {
  test('draft can move to scheduled or running', () => {
    expect(isValidStatusTransition('draft', 'scheduled')).toBe(true);
    expect(isValidStatusTransition('draft', 'running')).toBe(true);
  });

  test('running can move to paused, stopped, or completed', () => {
    expect(isValidStatusTransition('running', 'paused')).toBe(true);
    expect(isValidStatusTransition('running', 'stopped')).toBe(true);
    expect(isValidStatusTransition('running', 'completed')).toBe(true);
  });

  test('paused can move to running or stopped', () => {
    expect(isValidStatusTransition('paused', 'running')).toBe(true);
    expect(isValidStatusTransition('paused', 'stopped')).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(isValidStatusTransition('draft', 'completed')).toBe(false);
    expect(isValidStatusTransition('completed', 'running')).toBe(false);
    expect(isValidStatusTransition('stopped', 'running')).toBe(false);
    expect(isValidStatusTransition('paused', 'completed')).toBe(false);
  });

  test('terminal states (completed/stopped/failed) and scheduled have no forward transition', () => {
    ['completed', 'stopped', 'failed', 'scheduled'].forEach((from) => {
      expect(isValidStatusTransition(from, 'running')).toBe(false);
    });
  });

  test('no-op (same status) and missing values are rejected', () => {
    expect(isValidStatusTransition('running', 'running')).toBe(false);
    expect(isValidStatusTransition(null, 'running')).toBe(false);
    expect(isValidStatusTransition('running', null)).toBe(false);
  });
});

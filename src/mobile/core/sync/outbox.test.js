// Integration test for the Dexie-backed outbox over a fake IndexedDB.
// Proves: offline enqueue, idempotent enqueue (no double-post), flush posts each
// intent once, and a replay of the same key does not re-post.
import './__testPolyfills'; // must precede fake-indexeddb (sets structuredClone)
import 'fake-indexeddb/auto';
import * as outbox from './outbox';

beforeEach(async () => {
  await outbox.clearOutbox();
});

describe('outbox (Dexie + fake-indexeddb)', () => {
  it('enqueues a pending intent and counts it', async () => {
    await outbox.enqueue({ idempotencyKey: 'k1', rpc: 'mobile_ping', args: { p: 1 } });
    const pend = await outbox.pending();
    expect(pend).toHaveLength(1);
    expect(pend[0].idempotencyKey).toBe('k1');
    expect((await outbox.counts()).pending).toBe(1);
  });

  it('is idempotent on enqueue — same key does not duplicate', async () => {
    await outbox.enqueue({ idempotencyKey: 'dup', rpc: 'mobile_ping', args: {} });
    await outbox.enqueue({ idempotencyKey: 'dup', rpc: 'mobile_ping', args: {} });
    expect((await outbox.pending())).toHaveLength(1);
  });

  it('flush posts each pending intent exactly once and marks it sent', async () => {
    await outbox.enqueue({ idempotencyKey: 'a', rpc: 'mobile_ping', args: {} });
    await outbox.enqueue({ idempotencyKey: 'b', rpc: 'mobile_ping', args: {} });

    const calls = [];
    const runner = async (intent) => { calls.push(intent.idempotencyKey); };
    const res = await outbox.flush(runner);

    expect(res.sent).toBe(2);
    expect(calls.sort()).toEqual(['a', 'b']);
    expect((await outbox.pending())).toHaveLength(0); // sent rows pruned out of pending
  });

  it('a replayed key is not re-posted after it was already sent', async () => {
    await outbox.enqueue({ idempotencyKey: 'once', rpc: 'mobile_ping', args: {} });
    let posts = 0;
    const runner = async () => { posts += 1; };

    await outbox.flush(runner); // first send
    await outbox.enqueue({ idempotencyKey: 'once', rpc: 'mobile_ping', args: {} }); // replay attempt
    await outbox.flush(runner); // should be a no-op (key already sent + pruned, re-enqueue blocked)

    expect(posts).toBe(1);
  });

  it('backs off (re-queues, not failed) on a transient error', async () => {
    await outbox.enqueue({ idempotencyKey: 'flaky', rpc: 'mobile_ping', args: {} });
    const runner = async () => { throw new Error('network down'); };
    const res = await outbox.flush(runner, { now: 1000 });

    expect(res.sent).toBe(0);
    const pend = await outbox.pending();
    expect(pend).toHaveLength(1);
    expect(pend[0].attempts).toBe(1);
    expect(pend[0].nextAttemptAt).toBeGreaterThan(1000); // scheduled for a future retry
  });
});

// Dexie-backed write outbox. Offline writes land here and flush when online.
// Decision logic (backoff, dedupe, exhaustion) lives in outboxPolicy.js (pure).

import mobileDb from './db';
import {
  nextBackoffMs,
  isExhausted,
  shouldDedupe,
  makeIntent,
} from './outboxPolicy';

/**
 * Enqueue an intent. Idempotent: re-enqueuing the same idempotencyKey is a no-op,
 * so a double-tap or a retry never double-posts.
 * @returns {Promise<object>} the stored row
 */
export async function enqueue(rawIntent) {
  const intent = makeIntent({ ...rawIntent, createdAt: rawIntent.createdAt ?? Date.now() });
  const existingKeys = await mobileDb.outbox.toCollection().primaryKeys();
  if (shouldDedupe(intent, existingKeys)) {
    return mobileDb.outbox.get(intent.idempotencyKey);
  }
  const row = {
    ...intent,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  };
  await mobileDb.outbox.put(row);
  return row;
}

/** All rows still awaiting a successful send (pending, not yet exhausted/failed). */
export async function pending() {
  return mobileDb.outbox.where('status').equals('pending').toArray();
}

/** Rows that exhausted their retries. */
export async function failed() {
  return mobileDb.outbox.where('status').equals('failed').toArray();
}

/** { pending, failed, sent } counts for the sync badge. */
export async function counts() {
  const [p, f, s] = await Promise.all([
    mobileDb.outbox.where('status').equals('pending').count(),
    mobileDb.outbox.where('status').equals('failed').count(),
    mobileDb.outbox.where('status').equals('sent').count(),
  ]);
  return { pending: p, failed: f, sent: s };
}

/** Drop ALL already-sent rows (housekeeping). */
export async function prune() {
  await mobileDb.outbox.where('status').equals('sent').delete();
}

/**
 * Drop sent rows older than `maxAgeMs` (keeps recent sent keys for replay dedupe).
 * @param {number} maxAgeMs default 1h
 */
export async function pruneOld(maxAgeMs = 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  await mobileDb.outbox
    .where('status').equals('sent')
    .and((r) => (r.sentAt || 0) < cutoff)
    .delete();
}

/**
 * Flush all due pending intents.
 * @param {(intent) => Promise<any>} rpcRunner runs one intent (e.g. supabase.rpc).
 *        Must resolve on success, reject on failure.
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{ sent: number, failed: number, skipped: number }>}
 */
export async function flush(rpcRunner, opts = {}) {
  const now = opts.now ?? Date.now();
  const rows = await pending();
  let sent = 0;
  let failedCount = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.nextAttemptAt && row.nextAttemptAt > now) {
      skipped += 1; // still backing off
      continue;
    }
    try {
      await rpcRunner({ rpc: row.rpc, args: row.args, idempotencyKey: row.idempotencyKey, entity: row.entity });
      await mobileDb.outbox.update(row.idempotencyKey, {
        status: 'sent',
        lastError: null,
        sentAt: Date.now(),
      });
      sent += 1;
    } catch (err) {
      const attempts = (row.attempts || 0) + 1;
      const exhausted = isExhausted(attempts);
      await mobileDb.outbox.update(row.idempotencyKey, {
        attempts,
        status: exhausted ? 'failed' : 'pending',
        nextAttemptAt: now + nextBackoffMs(attempts),
        lastError: err && err.message ? err.message : String(err),
      });
      if (exhausted) failedCount += 1;
    }
  }

  // NOTE: we intentionally do NOT prune sent rows here. Keeping the sent keys
  // around lets enqueue() dedupe a replay of an already-sent intent within the
  // session (belt-and-braces on top of the server-side ON CONFLICT guard).
  // Call prune() / pruneOld() explicitly (useSync does this on a timer).
  return { sent, failed: failedCount, skipped };
}

/** Wipe the outbox (used in tests / reset). */
export async function clearOutbox() {
  await mobileDb.outbox.clear();
}

export default { enqueue, pending, failed, counts, flush, prune, pruneOld, clearOutbox };

// PURE outbox policy — backoff + dedupe decisions, no IDB, no supabase, no time.
// Unit-tested directly. The Dexie-backed outbox (outbox.js) consumes these.

// An "intent" is a serialisable description of a write the user made:
//   { idempotencyKey, rpc, args, entity?, createdAt }
// idempotencyKey makes replay safe end-to-end (the server RPC dedupes on it too).

export const BASE_BACKOFF_MS = 2000;     // first retry after ~2s
export const MAX_BACKOFF_MS = 5 * 60 * 1000; // cap at 5 min
export const MAX_ATTEMPTS = 8;           // give up (mark failed) after this many tries

/**
 * Exponential backoff with a hard cap. attempts=0 → BASE; doubles each attempt.
 * @param {number} attempts number of failed attempts so far
 * @returns {number} delay in ms before the next attempt
 */
export function nextBackoffMs(attempts) {
  const n = Math.max(0, Number(attempts) || 0);
  const raw = BASE_BACKOFF_MS * 2 ** n;
  return Math.min(raw, MAX_BACKOFF_MS);
}

/** True once an intent has burned through MAX_ATTEMPTS and should be parked as failed. */
export function isExhausted(attempts) {
  return (Number(attempts) || 0) >= MAX_ATTEMPTS;
}

/**
 * Dedupe guard: should this intent be skipped because we've already seen its key?
 * @param {{idempotencyKey:string}} intent
 * @param {Set<string>|Array<string>} seenKeys keys already enqueued/sent
 * @returns {boolean} true => skip (duplicate)
 */
export function shouldDedupe(intent, seenKeys) {
  const key = intent && intent.idempotencyKey;
  if (!key) return false;
  if (seenKeys instanceof Set) return seenKeys.has(key);
  return Array.isArray(seenKeys) && seenKeys.includes(key);
}

/** Normalize a raw submit into a well-formed intent (pure; caller supplies key + ts). */
export function makeIntent({ idempotencyKey, rpc, args = {}, entity = null, createdAt }) {
  return {
    idempotencyKey: String(idempotencyKey),
    rpc: String(rpc),
    args: args || {},
    entity: entity || null,
    createdAt: createdAt ?? null,
  };
}

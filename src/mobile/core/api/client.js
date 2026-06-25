// Thin data client for the Factory Ops App. The ERP is the single source of truth:
//   - read()  : PostgREST select (with optional cache fallback when offline)
//   - rpc()   : direct RPC call (online-only convenience)
//   - submit(): every write goes through the outbox so it survives offline + replays idempotently.

import { supabase } from '../../../lib/supabaseClient';
import * as outbox from '../sync/outbox';
import * as cache from '../sync/cache';
import { newKey } from './idempotency';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * Read a table. When online: fetch via PostgREST, refresh the cache, return rows.
 * When offline (or on error): fall back to the cached snapshot for `cacheAs`.
 *
 * @param {string} table   physical table/view name
 * @param {object} q       { select, filters:[{col,op,val}], order:{col,ascending}, limit, cacheAs }
 */
export async function read(table, q = {}) {
  const cacheKey = q.cacheAs || table;
  if (isOnline()) {
    try {
      let query = supabase.from(table).select(q.select || '*');
      (q.filters || []).forEach((f) => {
        const op = f.op || 'eq';
        query = query[op](f.col, f.val);
      });
      if (q.order) query = query.order(q.order.col, { ascending: q.order.ascending !== false });
      if (q.limit) query = query.limit(q.limit);
      const { data, error } = await query;
      if (error) throw error;
      await cache.put(cacheKey, data || []);
      return data || [];
    } catch (err) {
      // fall through to cache on any network/PostgREST failure
      return cache.get(cacheKey);
    }
  }
  return cache.get(cacheKey);
}

/** Direct RPC (online). Used internally by the outbox runner and for online-only reads. */
export async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

/** The runner the outbox uses to actually post one intent. */
export async function runIntent({ rpc: rpcName, args }) {
  return rpc(rpcName, args);
}

/**
 * Submit a write. Always enqueued in the outbox (works offline). If we're online,
 * we opportunistically flush right away so the happy path is instant.
 *
 * @param {{ rpc:string, args?:object, entity?:string, idempotencyKey?:string }} intent
 * @returns {Promise<{ queued:true, idempotencyKey:string }>}
 */
export async function submit(intent) {
  const idempotencyKey = intent.idempotencyKey || newKey();
  await outbox.enqueue({
    idempotencyKey,
    rpc: intent.rpc,
    args: intent.args || {},
    entity: intent.entity || null,
  });
  if (isOnline()) {
    // best-effort immediate flush; failures just stay queued for useSync to retry
    outbox.flush(runIntent).catch(() => {});
  }
  return { queued: true, idempotencyKey };
}

export default { read, rpc, submit, runIntent, isOnline };

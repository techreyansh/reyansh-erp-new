// Dexie-backed read cache. One row per entity holds the last fetched list so
// screens render offline. The pure expiry helper (isStale) is unit-tested.

import mobileDb from './db';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h default freshness window

/**
 * PURE: is a snapshot taken at `ts` older than `ttl` relative to `now`?
 * Missing ts → stale. ttl<=0 → never stale (treat as permanent).
 */
export function isStale(ts, ttl = DEFAULT_TTL_MS, now = Date.now()) {
  if (!ts) return true;
  if (!ttl || ttl <= 0) return false;
  return now - ts > ttl;
}

/** Store a fresh list for `entity`. */
export async function put(entity, rows) {
  await mobileDb.cache.put({
    entity: String(entity),
    rows: Array.isArray(rows) ? rows : [],
    ts: Date.now(),
  });
}

/** Read the cached list for `entity` (rows only). Empty array if absent. */
export async function get(entity) {
  const row = await mobileDb.cache.get(String(entity));
  return row && Array.isArray(row.rows) ? row.rows : [];
}

/** Read the full cache row (rows + ts) for staleness checks. */
export async function getMeta(entity) {
  return mobileDb.cache.get(String(entity));
}

/** True when the entity is missing or older than ttl. */
export async function stale(entity, ttl = DEFAULT_TTL_MS) {
  const row = await getMeta(entity);
  return isStale(row && row.ts, ttl);
}

export async function clearCache() {
  await mobileDb.cache.clear();
}

export default { put, get, getMeta, stale, isStale, clearCache, DEFAULT_TTL_MS };

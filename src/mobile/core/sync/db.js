// Single Dexie database for the Factory Ops App offline layer.
// Two stores: the write outbox and the read cache. Kept tiny on purpose —
// the outbox owns offline writes; the cache owns offline reads. Nothing else.

import Dexie from 'dexie';

export const mobileDb = new Dexie('factoryOps');

mobileDb.version(1).stores({
  // outbox: queued writes awaiting sync. idempotencyKey is the natural primary key.
  //   status: 'pending' | 'sent' | 'failed'
  outbox: 'idempotencyKey, status, createdAt',
  // cache: read snapshots keyed by entity name. One row per entity (whole list).
  cache: 'entity, ts',
});

export default mobileDb;

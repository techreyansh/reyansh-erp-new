// Test-only polyfill: fake-indexeddb + Dexie's cache middleware need structuredClone,
// which is absent under the jsdom/node combo CRA's jest runs on. Imported FIRST by
// the outbox integration test so it runs before fake-indexeddb/auto initialises.
if (typeof structuredClone === 'undefined') {
  // eslint-disable-next-line no-global-assign
  global.structuredClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
}

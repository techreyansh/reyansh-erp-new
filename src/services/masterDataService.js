/**
 * Master Data service — thin generic CRUD over any master table plus a unified
 * cross-reference search. Uses the legacy generic db layer (db.js) which
 * transparently handles both wrapped ({record jsonb}) and flat-column schemas.
 */
import { getTableRows, insertTableRow, updateTableRowById, deleteTableRowById } from '../lib/db';
import { MASTER_ENTITIES, pickField } from '../config/masterDataConfig';

const SYSTEM_KEYS = new Set(['id', 'created_at', 'updated_at', 'deleted_at', 'sort_order', 'record']);

/** Data (non-system) field names present on a row. */
export const dataFields = (row) => Object.keys(row || {}).filter((k) => !SYSTEM_KEYS.has(k));

export async function listEntity(table) {
  if (!table) return [];
  const rows = await getTableRows(table);
  return Array.isArray(rows) ? rows : [];
}

export async function countEntity(table) {
  if (!table) return null;
  try { return (await listEntity(table)).length; } catch { return null; }
}

export async function createRow(table, obj) { return insertTableRow(table, obj); }
export async function updateRow(table, id, obj) { return updateTableRowById(table, id, obj); }
export async function deleteRow(table, id) { return deleteTableRowById(table, id); }

// ---------------- Cross-reference search (in-memory, cached) ----------------
const _cache = new Map(); // table -> rows

/** Load every searchable entity once (parallel) so search is instant. */
export async function primeSearch() {
  const searchable = MASTER_ENTITIES.filter((e) => e.table);
  await Promise.all(searchable.map(async (e) => {
    if (_cache.has(e.table)) return;
    try { _cache.set(e.table, await listEntity(e.table)); }
    catch { _cache.set(e.table, []); }
  }));
}

export function invalidate(table) { if (table) _cache.delete(table); }

/** Ensure data is primed, then return a {entityKey: rowCount} map from the cache. */
export async function counts() {
  await primeSearch();
  const out = {};
  for (const e of MASTER_ENTITIES) {
    if (e.table) out[e.key] = (_cache.get(e.table) || []).length;
  }
  return out;
}

/** Search loaded master data by title or code across all entities. */
export function search(query, limitPerEntity = 6) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (const e of MASTER_ENTITIES) {
    if (!e.table) continue;
    const rows = _cache.get(e.table) || [];
    const hits = [];
    for (const row of rows) {
      const title = String(pickField(row, e.title) || '');
      const code = String(pickField(row, e.code) || '');
      if (title.toLowerCase().includes(q) || code.toLowerCase().includes(q)) {
        hits.push({
          entityKey: e.key, entityLabel: e.label, icon: e.icon,
          id: row.id, title: title || code || '(untitled)', code,
          subtitle: String(pickField(row, e.subtitle) || ''),
          managerRoute: e.managerRoute || null,
        });
        if (hits.length >= limitPerEntity) break;
      }
    }
    out.push(...hits);
  }
  return out;
}

const masterDataService = {
  listEntity, countEntity, createRow, updateRow, deleteRow,
  dataFields, primeSearch, invalidate, search, counts,
};
export default masterDataService;

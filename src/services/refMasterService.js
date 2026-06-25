// Generic master-table CRUD (UX overhaul Wave 2+). One small service that any
// simple reference master (colour, size, material, presets, rules…) reuses, so
// new masters are config — not new service code. Archive = soft-delete via
// archived_at; the master_audit_trigger logs every change automatically.
import { supabase } from '../lib/supabaseClient';

function unwrap(res, ctx) {
  const { data, error } = res;
  if (error) throw new Error(`${ctx}: ${error.message || 'error'}`);
  return data;
}

/** All rows of a table, ordered. */
export async function listRows(table, orderBy = 'created_at', ascending = true) {
  return unwrap(await supabase.from(table).select('*').order(orderBy, { ascending }), `List ${table}`) || [];
}

/** Upsert a row (update when it has an id, else insert). Strips undefined keys. */
export async function saveRow(table, row) {
  const clean = {};
  Object.keys(row).forEach((k) => { if (row[k] !== undefined) clean[k] = row[k]; });
  if (row.id) {
    const { id, ...patch } = clean;
    return unwrap(await supabase.from(table).update(patch).eq('id', id).select().single(), `Update ${table}`);
  }
  return unwrap(await supabase.from(table).insert(clean).select().single(), `Create ${table}`);
}

/** Duplicate a row: copy copyCols, suffix the code field. */
export async function duplicateRow(table, row, copyCols, codeField) {
  const copy = {};
  copyCols.forEach((k) => { if (row[k] !== undefined) copy[k] = row[k]; });
  copy.archived_at = null;
  if (codeField) copy[codeField] = `${row[codeField] || 'COPY'}-2`;
  return unwrap(await supabase.from(table).insert(copy).select().single(), `Duplicate ${table}`);
}

/** Archive (soft-delete) / restore a row. */
export async function archiveRow(table, id, archived = true) {
  return unwrap(
    await supabase.from(table).update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select().single(),
    `Archive ${table}`
  );
}

/** Hard delete. */
export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
  return true;
}

/** Build a {list,save,duplicate,archive,delete} bundle bound to one table. */
export function makeMaster(table, { copyCols = [], codeField = 'code', orderBy = 'code' } = {}) {
  return {
    list: () => listRows(table, orderBy),
    save: (row) => saveRow(table, row),
    duplicate: (row) => duplicateRow(table, row, copyCols.length ? copyCols : Object.keys(row).filter((k) => !['id', 'created_at', 'updated_at'].includes(k)), codeField),
    archive: (id, archived) => archiveRow(table, id, archived),
    delete: (id) => deleteRow(table, id),
  };
}

const refMasterService = { listRows, saveRow, duplicateRow, archiveRow, deleteRow, makeMaster };
export default refMasterService;

// Orchestration for the bulk-import framework: turn parsed rows into validated,
// tagged records (new / update / invalid) so the dialog can preview them before
// applying. The per-dataset write logic lives in each dataset's apply().
import { norm } from "./parse";

/**
 * Analyze raw parsed rows against existing records.
 * Returns [{ i, rec, match, status:'new'|'update'|'invalid', errors[], warnings[], valid }].
 */
export async function analyzeRows(dataset, rawRows) {
  const existing = await dataset.fetchExisting().catch(() => []);
  const idx = new Map();
  (existing || []).forEach((r) => {
    const k = norm(r[dataset.matchKey]);
    if (k) idx.set(k, r);
  });

  return (rawRows || []).map((raw, i) => {
    const rec = dataset.rowToRecord ? dataset.rowToRecord(raw) : raw;
    const v = dataset.validateRow ? dataset.validateRow(rec) : { errors: [], warnings: [] };
    const mk = norm(rec[dataset.matchKey]);
    const match = mk ? idx.get(mk) || null : null;
    const hasErr = (v.errors || []).length > 0;
    let status = "new";
    if (hasErr || !mk) status = "invalid";
    else if (match) status = "update";
    return {
      i,
      rec,
      match,
      status,
      errors: v.errors || [],
      warnings: v.warnings || [],
      valid: !hasErr && !!mk,
    };
  });
}

export function summarize(analyzed) {
  const s = { total: analyzed.length, new: 0, update: 0, invalid: 0 };
  (analyzed || []).forEach((a) => {
    s[a.status] = (s[a.status] || 0) + 1;
  });
  return s;
}

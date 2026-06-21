// Master-data audit history (UX overhaul Wave 0). Reads master_audit_log
// (written automatically by master_audit_trigger) and lets the UI attach a
// reason to the most recent change. Generic over any audited master table.
import { supabase } from '../lib/supabaseClient';

/** Recent audit entries for one master record, newest first. */
export async function listAudit(tableName, recordId, limit = 50) {
  if (!tableName || recordId == null) return [];
  const { data, error } = await supabase
    .from('master_audit_log')
    .select('id, action, changed_by_email, changed_at, old_value, new_value, reason')
    .eq('table_name', tableName)
    .eq('record_id', String(recordId))
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

/** Attach a reason to the latest audit row for a record (after archive/delete/edit). */
export async function setAuditReason(tableName, recordId, reason) {
  if (!tableName || recordId == null || !reason) return;
  try {
    await supabase.rpc('master_audit_set_reason', {
      p_table: tableName, p_record_id: String(recordId), p_reason: reason,
    });
  } catch { /* non-fatal */ }
}

/**
 * Diff two row snapshots (old/new jsonb) into changed fields. Skips noise cols.
 * Used to render "Old → New" in the history drawer.
 */
export function diffRows(oldRow, newRow, skip = ['updated_at', 'created_at', 'id']) {
  const out = [];
  const keys = new Set([...Object.keys(oldRow || {}), ...Object.keys(newRow || {})]);
  for (const k of keys) {
    if (skip.includes(k)) continue;
    const a = oldRow ? oldRow[k] : undefined;
    const b = newRow ? newRow[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, from: a, to: b });
  }
  return out;
}

const masterAuditService = { listAudit, setAuditReason, diffRows };
export default masterAuditService;

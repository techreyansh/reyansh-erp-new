// Per-employee attendance (public.employee_attendance). Defensive: read
// degrades to [] if the table is missing so the UI never hard-fails.
import { supabase } from '../lib/supabaseClient';

export const ATTENDANCE_STATUSES = [
  { key: 'present', label: 'Present', color: 'success' },
  { key: 'absent', label: 'Absent', color: 'error' },
  { key: 'half_day', label: 'Half day', color: 'warning' },
  { key: 'leave', label: 'Leave', color: 'info' },
  { key: 'holiday', label: 'Holiday', color: 'default' },
  { key: 'week_off', label: 'Week off', color: 'default' },
];

/** Attendance rows for an employee within [fromDate, toDate] (YYYY-MM-DD). */
export async function listAttendance(employeeId, fromDate, toDate) {
  if (!employeeId) return [];
  try {
    let q = supabase.from('employee_attendance').select('*').eq('employee_id', employeeId);
    if (fromDate) q = q.gte('date', fromDate);
    if (toDate) q = q.lte('date', toDate);
    const { data, error } = await q.order('date', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

/** Insert or update the attendance for one (employee, date). */
export async function upsertAttendance(employeeId, date, fields, markedByEmail) {
  if (!employeeId || !date) throw new Error('Employee and date are required.');
  const payload = {
    employee_id: employeeId,
    date,
    status: fields.status || 'present',
    check_in: fields.check_in || null,
    check_out: fields.check_out || null,
    note: fields.note || null,
    marked_by_email: markedByEmail || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('employee_attendance')
    .upsert(payload, { onConflict: 'employee_id,date' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAttendance(id) {
  if (!id) return;
  const { error } = await supabase.from('employee_attendance').delete().eq('id', id);
  if (error) throw error;
}

/** Count statuses for a set of rows (for the monthly summary). */
export function summarizeAttendance(rows) {
  const out = {};
  for (const s of ATTENDANCE_STATUSES) out[s.key] = 0;
  for (const r of rows || []) if (out[r.status] != null) out[r.status] += 1;
  return out;
}

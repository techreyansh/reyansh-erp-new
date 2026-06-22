// Employee leave requests + approval (public.employee_leave_requests).
// Defensive reads (degrade to [] if the table is missing).
import { supabase } from '../lib/supabaseClient';

export const LEAVE_TYPES = [
  { key: 'casual', label: 'Casual', entitled: 12 },
  { key: 'sick', label: 'Sick', entitled: 12 },
  { key: 'earned', label: 'Earned', entitled: 15 },
  { key: 'unpaid', label: 'Unpaid', entitled: null },
  { key: 'other', label: 'Other', entitled: null },
];

export const LEAVE_STATUS_COLOR = {
  pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'default',
};

/** Inclusive whole-day count between two YYYY-MM-DD dates. */
export function dayCount(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start), b = new Date(end);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export async function listLeaveRequests(employeeId) {
  if (!employeeId) return [];
  try {
    const { data, error } = await supabase
      .from('employee_leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .order('start_date', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

export async function createLeaveRequest(employeeId, { leave_type, start_date, end_date, reason }) {
  if (!employeeId || !start_date || !end_date) throw new Error('Type and dates are required.');
  const days = dayCount(start_date, end_date);
  if (days <= 0) throw new Error('End date must be on or after the start date.');
  const { data, error } = await supabase
    .from('employee_leave_requests')
    .insert({ employee_id: employeeId, leave_type: leave_type || 'casual', start_date, end_date, days, reason: reason || null })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Approve/reject/cancel a request. status in approved|rejected|cancelled. */
export async function decideLeaveRequest(id, status, deciderEmail) {
  if (!id) return;
  const { error } = await supabase
    .from('employee_leave_requests')
    .update({
      status,
      decided_by_email: deciderEmail || null,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteLeaveRequest(id) {
  if (!id) return;
  const { error } = await supabase.from('employee_leave_requests').delete().eq('id', id);
  if (error) throw error;
}

/** Balance per type: entitled, used (approved days this calendar year), remaining. */
export function summarizeLeave(rows) {
  const year = new Date().getFullYear();
  const usedByType = {};
  for (const r of rows || []) {
    if (r.status !== 'approved') continue;
    if (new Date(r.start_date).getFullYear() !== year) continue;
    usedByType[r.leave_type] = (usedByType[r.leave_type] || 0) + Number(r.days || 0);
  }
  return LEAVE_TYPES.map((t) => {
    const used = usedByType[t.key] || 0;
    return { ...t, used, remaining: t.entitled == null ? null : t.entitled - used };
  });
}

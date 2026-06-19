/**
 * MIS — EM Executive Meeting service.
 * Weekly accountability roster + per-person scorecards. The whole calc engine
 * runs server-side (Postgres RPCs `em_roster` / `em_person_week_score`); this
 * layer only formats week keys and normalizes errors.
 */
import { supabase } from '../lib/supabaseClient';

/** Monday (week start) of a given Date, as an ISO 'YYYY-MM-DD' string (local). */
function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

/** Date → 'YYYY-MM-DD' (local, no timezone shift). */
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday of the current week, ISO 'YYYY-MM-DD'. */
export function getCurrentWeekStart() {
  return mondayOf(new Date());
}

/** Shift a 'YYYY-MM-DD' week start by `n` weeks (negative = back). Returns ISO string. */
export function addWeeks(weekStart, n) {
  const [y, m, d] = String(weekStart).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n * 7);
  return toISODate(dt);
}

/** Roster for a week: array of { employee_id, name, email, employee_code, final_score, band }. */
export async function getRoster(weekStart) {
  const { data, error } = await supabase.rpc('em_roster', { p_week_start: weekStart });
  if (error) {
    console.error('[misService] em_roster failed:', error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/** Full scorecard object for one person + week, or null on error. */
export async function getPersonScore(email, weekStart) {
  if (!email) return null;
  const { data, error } = await supabase.rpc('em_person_week_score', {
    p_email: email,
    p_week_start: weekStart,
  });
  if (error) {
    console.error('[misService] em_person_week_score failed:', error.message);
    return null;
  }
  return data || null;
}

const misService = { getCurrentWeekStart, addWeeks, getRoster, getPersonScore };
export default misService;

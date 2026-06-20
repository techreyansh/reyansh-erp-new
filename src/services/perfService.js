/**
 * Performance Review service.
 *
 * Weekly performance-accountability data layer. Scores are computed server-side
 * via Postgres RPCs (`perf_week_summary`, `perf_person_week_score`,
 * `perf_department_dashboard`); reviews & commitments are plain tables guarded
 * by RLS. This module only formats week keys and normalizes errors — it never
 * decides authorization (the UI gates manager/CEO actions, the DB enforces them).
 *
 * Roster comes from the SINGLE employee master `public.employees` (no duplicate
 * records) — the RPCs join against it, so we never dedupe here.
 */
import { supabase } from '../lib/supabaseClient';

/** Date → 'YYYY-MM-DD' (local, no timezone shift). */
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Monday (week start) of a given date, as an ISO 'YYYY-MM-DD' string (local).
 * Accepts a Date, an ISO string, or nothing (defaults to today).
 */
export function weekStartOf(date) {
  const base = date ? new Date(date) : new Date();
  // Guard against invalid input — fall back to today.
  const safe = Number.isNaN(base.getTime()) ? new Date() : base;
  const d = new Date(safe.getFullYear(), safe.getMonth(), safe.getDate());
  const dow = d.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

/** Monday of the current week, ISO 'YYYY-MM-DD'. */
export function getCurrentWeekStart() {
  return weekStartOf(new Date());
}

/** Shift a 'YYYY-MM-DD' week start by `n` weeks (negative = back). Returns ISO string. */
export function addWeeks(weekStart, n) {
  const [y, m, d] = String(weekStart).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n * 7);
  return toISODate(dt);
}

/** Lowercase + trim an email for stable UNIQUE(lower(email), week_start) matching. */
function normEmail(email) {
  return email ? String(email).trim().toLowerCase() : null;
}

/** Clamp a value into the 0–100 integer range used by review scores. */
function clamp0100(v) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(100, n));
}

/**
 * Weekly roster + scores for everyone.
 * @returns {Promise<Array<{ email, full_name, department, designation, score, band, prev_score }>>}
 */
export async function weekSummary(weekStart) {
  const { data, error } = await supabase.rpc('perf_week_summary', { p_week_start: weekStart });
  if (error) {
    console.error('[perfService] perf_week_summary failed:', error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Full per-person weekly score breakdown, or null on error.
 * Shape: { email, week_start, score, band, locked, manager_remarks, categories:{...} }.
 */
export async function personScore(email, weekStart) {
  const p_email = normEmail(email);
  if (!p_email) return null;
  const { data, error } = await supabase.rpc('perf_person_week_score', {
    p_email,
    p_week_start: weekStart,
  });
  if (error) {
    console.error('[perfService] perf_person_week_score failed:', error.message);
    return null;
  }
  return data || null;
}

/**
 * Upsert a manager review for one person/week.
 * Keyed on UNIQUE(lower(email), week_start) via onConflict. Defensive: falls back
 * to select-then-update/insert if the upsert is rejected (e.g. conflict target
 * is an expression index PostgREST can't target directly).
 * @returns {Promise<{ ok: boolean, error: (string|null) }>}
 */
export async function saveReview({ email, weekStart, meetingParticipation, managerEval, managerRemarks }) {
  const employee_email = normEmail(email);
  if (!employee_email || !weekStart) {
    return { ok: false, error: 'Missing employee or week.' };
  }
  const row = {
    employee_email,
    week_start: weekStart,
    meeting_participation: clamp0100(meetingParticipation),
    manager_eval: clamp0100(managerEval),
    manager_remarks: managerRemarks == null ? null : String(managerRemarks),
  };

  // Preferred path: upsert on the (lower(email), week_start) conflict target.
  const { error: upErr } = await supabase
    .from('perf_reviews')
    .upsert(row, { onConflict: 'employee_email,week_start' });
  if (!upErr) return { ok: true, error: null };

  // Fallback: select-then-update/insert (handles expression-index conflict targets).
  console.warn('[perfService] saveReview upsert fell back to select+write:', upErr.message);
  const { data: existing, error: selErr } = await supabase
    .from('perf_reviews')
    .select('id')
    .ilike('employee_email', employee_email)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (selErr) {
    console.error('[perfService] saveReview lookup failed:', selErr.message);
    return { ok: false, error: selErr.message };
  }

  if (existing?.id) {
    const { error: updErr } = await supabase
      .from('perf_reviews')
      .update(row)
      .eq('id', existing.id);
    if (updErr) {
      console.error('[perfService] saveReview update failed:', updErr.message);
      return { ok: false, error: updErr.message };
    }
    return { ok: true, error: null };
  }

  const { error: insErr } = await supabase.from('perf_reviews').insert(row);
  if (insErr) {
    console.error('[perfService] saveReview insert failed:', insErr.message);
    return { ok: false, error: insErr.message };
  }
  return { ok: true, error: null };
}

/**
 * Lock (or unlock) every review row for a week — applies to the whole team.
 * Rows that don't yet exist are not created here; locking is a review-finalisation
 * gate, so it only stamps reviews that have been opened.
 * @returns {Promise<{ ok: boolean, locked: boolean, error: (string|null) }>}
 */
export async function lockWeek(weekStart, locked = true) {
  if (!weekStart) return { ok: false, locked, error: 'Missing week.' };
  const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: null }));
  const lockedBy = userData?.user?.email || null;
  const patch = locked
    ? { locked: true, locked_by: lockedBy, locked_at: new Date().toISOString() }
    : { locked: false, locked_by: null, locked_at: null };

  const { error } = await supabase
    .from('perf_reviews')
    .update(patch)
    .eq('week_start', weekStart);
  if (error) {
    console.error('[perfService] lockWeek failed:', error.message);
    return { ok: false, locked: !locked, error: error.message };
  }
  return { ok: true, locked, error: null };
}

/**
 * Lock (or unlock) a single employee's review for a week. Creates the review row
 * if it doesn't exist yet so the lock state always has somewhere to live.
 * @returns {Promise<{ ok: boolean, locked: boolean, error: (string|null) }>}
 */
export async function lockPerson(email, weekStart, locked = true) {
  const employee_email = normEmail(email);
  if (!employee_email || !weekStart) return { ok: false, locked, error: 'Missing employee or week.' };
  const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: null }));
  const lockedBy = userData?.user?.email || null;
  const patch = locked
    ? { locked: true, locked_by: lockedBy, locked_at: new Date().toISOString() }
    : { locked: false, locked_by: null, locked_at: null };

  const { data: existing } = await supabase
    .from('perf_reviews')
    .select('id')
    .ilike('employee_email', employee_email)
    .eq('week_start', weekStart)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from('perf_reviews').update(patch).eq('id', existing.id);
    if (error) {
      console.error('[perfService] lockPerson update failed:', error.message);
      return { ok: false, locked: !locked, error: error.message };
    }
    return { ok: true, locked, error: null };
  }

  const { error } = await supabase
    .from('perf_reviews')
    .insert({ employee_email, week_start: weekStart, ...patch });
  if (error) {
    console.error('[perfService] lockPerson insert failed:', error.message);
    return { ok: false, locked: !locked, error: error.message };
  }
  return { ok: true, locked, error: null };
}

/**
 * List commitments for one person/week, newest first.
 * @returns {Promise<Array<{ id, employee_email, week_start, title, due_date, status, delivered_at }>>}
 */
export async function listCommitments(email, weekStart) {
  const employee_email = normEmail(email);
  if (!employee_email || !weekStart) return [];
  const { data, error } = await supabase
    .from('perf_commitments')
    .select('*')
    .ilike('employee_email', employee_email)
    .eq('week_start', weekStart)
    .order('due_date', { ascending: true });
  if (error) {
    console.error('[perfService] listCommitments failed:', error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Add a new commitment (status defaults to 'committed').
 * @returns {Promise<{ ok: boolean, row: (object|null), error: (string|null) }>}
 */
export async function addCommitment({ email, weekStart, title, dueDate }) {
  const employee_email = normEmail(email);
  const cleanTitle = title ? String(title).trim() : '';
  if (!employee_email || !weekStart || !cleanTitle) {
    return { ok: false, row: null, error: 'Missing employee, week, or title.' };
  }
  const { data, error } = await supabase
    .from('perf_commitments')
    .insert({
      employee_email,
      week_start: weekStart,
      title: cleanTitle,
      due_date: dueDate || null,
      status: 'committed',
    })
    .select()
    .maybeSingle();
  if (error) {
    console.error('[perfService] addCommitment failed:', error.message);
    return { ok: false, row: null, error: error.message };
  }
  return { ok: true, row: data || null, error: null };
}

const COMMITMENT_STATUSES = ['committed', 'delivered', 'missed', 'carried_over'];

/**
 * Update a commitment's status. Stamps delivered_at when marking delivered,
 * clears it otherwise.
 * @returns {Promise<{ ok: boolean, error: (string|null) }>}
 */
export async function setCommitmentStatus(id, status) {
  if (!id || !COMMITMENT_STATUSES.includes(status)) {
    return { ok: false, error: 'Invalid commitment id or status.' };
  }
  const patch = {
    status,
    delivered_at: status === 'delivered' ? new Date().toISOString() : null,
  };
  const { error } = await supabase.from('perf_commitments').update(patch).eq('id', id);
  if (error) {
    console.error('[perfService] setCommitmentStatus failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/** Department-level rollup for a week, or null on error. */
export async function departmentDashboard(weekStart) {
  const { data, error } = await supabase.rpc('perf_department_dashboard', { p_week_start: weekStart });
  if (error) {
    console.error('[perfService] perf_department_dashboard failed:', error.message);
    return null;
  }
  return data ?? null;
}

const perfService = {
  weekStartOf,
  getCurrentWeekStart,
  addWeeks,
  weekSummary,
  personScore,
  saveReview,
  lockWeek,
  lockPerson,
  listCommitments,
  addCommitment,
  setCommitmentStatus,
  departmentDashboard,
};
export default perfService;

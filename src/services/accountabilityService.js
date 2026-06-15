/**
 * Accountability Module service.
 * Weekly weighted scorecards — calc engine runs server-side (Postgres RPCs).
 * See supabase/migrations/20260614130000_accountability_module.sql.
 */
import { supabase } from '../lib/supabaseClient';

/** Caller's system role (HOD | PROCESS_COORD | PLANT_HEAD | DIRECTOR) or null. */
export async function getMyRole() {
  const { data, error } = await supabase.rpc('acc_my_role');
  if (error) return null;
  return data || null;
}

export async function getRoles() {
  const { data, error } = await supabase.from('acc_roles').select('id, code, name').order('sort_order');
  if (error) throw new Error(error.message);
  return data || [];
}

/** Register the current auth user as an accountability employee. */
export async function registerMe(fullName, roleCode, systemRole = 'HOD') {
  const { data, error } = await supabase.rpc('acc_register_me', {
    p_full_name: fullName, p_role_code: roleCode, p_system_role: systemRole,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Current-week scorecard for the logged-in user (auto-creates it + snapshots KPIs). */
export async function getMyScorecard() {
  const { data: scId, error } = await supabase.rpc('acc_my_current_scorecard');
  if (error) throw new Error(error.message);
  if (!scId) return { registered: false };
  return loadScorecard(scId);
}

export async function loadScorecard(scId) {
  const { data: scorecard, error: e1 } = await supabase
    .from('acc_scorecards')
    .select('*, week:acc_weeks(*), employee:acc_employees(*, role:acc_roles(*))')
    .eq('id', scId)
    .single();
  if (e1) throw new Error(e1.message);
  const { data: kpis, error: e2 } = await supabase
    .from('acc_scorecard_kpis').select('*').eq('scorecard_id', scId).order('sort_order');
  if (e2) throw new Error(e2.message);
  return { registered: true, scorecard, kpis: kpis || [] };
}

/** Update one KPI row (target/actual/note) and recompute the scorecard server-side. */
export async function updateKpi(scorecardId, kpiRowId, patch) {
  const { error } = await supabase.from('acc_scorecard_kpis').update(patch).eq('id', kpiRowId);
  if (error) throw new Error(error.message);
  const { error: rerr } = await supabase.rpc('acc_recompute_scorecard', { p_scorecard: scorecardId });
  if (rerr) throw new Error(rerr.message);
}

export async function setScorecardStatus(scorecardId, status) {
  const patch = { status };
  if (status === 'SUBMITTED') patch.submitted_at = new Date().toISOString();
  const { error } = await supabase.from('acc_scorecards').update(patch).eq('id', scorecardId);
  if (error) throw new Error(error.message);
  await supabase.rpc('acc_recompute_scorecard', { p_scorecard: scorecardId });
}

/** Open action items owned by an employee (for the My Scorecard side panel). */
export async function getMyOpenActions(employeeId) {
  if (!employeeId) return [];
  const { data, error } = await supabase
    .from('acc_action_items')
    .select('*')
    .eq('owner_employee_id', employeeId)
    .neq('status', 'CLOSED')
    .order('due_date');
  if (error) return [];
  return data || [];
}

/** Get-or-create + load the current-week scorecard for a specific employee by email. */
export async function getScorecardByEmail(email) {
  if (!email) return { registered: false };
  const { data: scId, error } = await supabase.rpc('acc_scorecard_for_email', { p_email: email });
  if (error) throw new Error(error.message);
  if (!scId) return { registered: false };
  return loadScorecard(scId);
}

/** Pull every ERP employee (employees_data) into the accountability register. Returns # newly added. */
export async function syncEmployees() {
  const { data, error } = await supabase.rpc('acc_sync_employees');
  if (error) throw new Error(error.message);
  return data || 0;
}

/** Full roster: every employee + their current-week score/band (for the register view). */
export async function getRoster() {
  const { data, error } = await supabase.rpc('acc_roster');
  if (error) throw new Error(error.message);
  return data || [];
}

/** Assign / change an employee's accountability role (admin). */
export async function assignRole(employeeId, roleCode, systemRole = null) {
  const { error } = await supabase.rpc('acc_assign_role', {
    p_employee: employeeId, p_role_code: roleCode, p_system_role: systemRole,
  });
  if (error) throw new Error(error.message);
}

/**
 * Live: invoke `onChange` whenever this employee's scorecard row changes (score recompute,
 * status change). Returns an unsubscribe fn. Pass null employeeId to listen to all.
 */
export function subscribeScorecard(employeeId, onChange) {
  const filter = employeeId ? { event: '*', schema: 'public', table: 'acc_scorecards', filter: `employee_id=eq.${employeeId}` }
                            : { event: '*', schema: 'public', table: 'acc_scorecards' };
  const channel = supabase
    .channel(`acc-scorecard-${employeeId || 'all'}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', filter, (payload) => onChange?.(payload))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** Plant dashboard: all scorecards for a week (Process Coord / Plant Head / Director). */
export async function getPlantDashboard(weekId) {
  let wId = weekId;
  if (!wId) {
    const { data: w } = await supabase.rpc('acc_ensure_week', { p_date: new Date().toISOString().slice(0, 10) });
    wId = Array.isArray(w) ? w[0]?.id : w?.id;
  }
  const { data: rows, error } = await supabase
    .from('acc_scorecards')
    .select('*, employee:acc_employees(full_name, role:acc_roles(name))')
    .eq('week_id', wId)
    .order('final_score_pct', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return { weekId: wId, rows: rows || [] };
}

const accountabilityService = {
  getMyRole, getRoles, registerMe, getMyScorecard, loadScorecard,
  updateKpi, setScorecardStatus, getMyOpenActions, getPlantDashboard,
  getScorecardByEmail, syncEmployees, getRoster, assignRole, subscribeScorecard,
};
export default accountabilityService;

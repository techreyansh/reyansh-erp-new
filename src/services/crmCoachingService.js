// CRM coaching playbook data layer. Reads crm_stage_playbook (per-stage
// talk-tracks / SLAs / objections); writes go through the CEO-gated definer RPC.
import { supabase } from "../lib/supabaseClient";

/** All playbook rows (RLS read-open). Never throws. */
export async function listPlaybook() {
  try {
    const { data, error } = await supabase.from("crm_stage_playbook").select("*");
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/** Map keyed `${scope}|${stage_key}` → row. */
export async function playbookMap() {
  const rows = await listPlaybook();
  const m = new Map();
  rows.forEach((r) => m.set(`${r.scope}|${r.stage_key}`, r));
  return m;
}

/** Upsert playbook rows (CEO/super only, via definer RPC). */
export async function savePlaybook(rows) {
  const { error } = await supabase.rpc("crm_save_playbook", { p_rows: rows });
  if (error) {
    if (/not_authorized/i.test(error.message)) throw new Error("Only an admin can edit the coaching playbook.");
    throw error;
  }
  return true;
}

const crmCoachingService = { listPlaybook, playbookMap, savePlaybook };
export default crmCoachingService;

// IE planning — data layer. Reads the cost-rate master (ie_cost_rates); the
// optimizer math lives in pure modules under services/ie/.
import { supabase } from '../lib/supabaseClient';

const FALLBACK = { labour_per_hr: 80, overtime_multiplier: 1.5, machine_per_hr: 50, indirect_pct: 0.15, currency: 'INR' };

/** Cost rates for a department, falling back to the default (department NULL) row. */
export async function getCostRates(department = null) {
  try {
    const { data } = await supabase.from('ie_cost_rates').select('*');
    const rows = data || [];
    const dept = department ? rows.find((r) => r.department === department) : null;
    const def = rows.find((r) => r.department == null) || rows[0] || null;
    return dept || def || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** Upsert the default (department NULL) cost-rate row. */
export async function saveCostRates(rates) {
  const row = {
    labour_per_hr: Number(rates.labour_per_hr) || 0,
    overtime_multiplier: Number(rates.overtime_multiplier) || 1.5,
    machine_per_hr: Number(rates.machine_per_hr) || 0,
    indirect_pct: Number(rates.indirect_pct) || 0,
  };
  const { data: existing } = await supabase.from('ie_cost_rates').select('id').is('department', null).limit(1).maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from('ie_cost_rates').update(row).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('ie_cost_rates').insert({ department: null, ...row });
    if (error) throw error;
  }
  return row;
}

/** The shared molding-machine fleet (ie_molding_machine). */
export async function listMoldingMachines() {
  try {
    const { data } = await supabase.from('ie_molding_machine').select('*').order('machine_code', { ascending: true });
    return data || [];
  } catch { return []; }
}

/** Insert/update a molding machine in the fleet. */
export async function saveMoldingMachine(m) {
  const row = {
    machine_code: m.machine_code || null, name: m.name || null,
    mold_type: m.mold_type || 'inner',
    cycle_time_sec: m.cycle_time_sec === '' || m.cycle_time_sec == null ? null : Number(m.cycle_time_sec),
    cavities: Number(m.cavities) || 1, available_hours: Number(m.available_hours) || 8,
    is_active: m.is_active !== false,
  };
  if (m.id) { const { error } = await supabase.from('ie_molding_machine').update(row).eq('id', m.id); if (error) throw error; }
  else { const { error } = await supabase.from('ie_molding_machine').insert(row); if (error) throw error; }
  return true;
}

export async function deleteMoldingMachine(id) {
  const { error } = await supabase.from('ie_molding_machine').delete().eq('id', id);
  if (error) throw error;
  return true;
}

const ieService = { getCostRates, saveCostRates, listMoldingMachines, saveMoldingMachine, deleteMoldingMachine };
export default ieService;

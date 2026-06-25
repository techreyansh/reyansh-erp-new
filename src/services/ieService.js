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

const ieService = { getCostRates };
export default ieService;

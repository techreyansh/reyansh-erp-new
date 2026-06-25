/**
 * IE planning — pure cost model (no network). Takes a staffing plan + standard
 * rates and returns the money. Rates come from ie_cost_rates (P1); the function
 * stays pure so it unit-tests without Supabase.
 *
 * rates: { labour_per_hr, overtime_multiplier, machine_per_hr, indirect_pct }
 */
const n = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

export function planCost(plan = {}, rates = {}, shiftHours = 0, overtimeHours = 0) {
  const r = {
    labour_per_hr: n(rates.labour_per_hr),
    overtime_multiplier: n(rates.overtime_multiplier, 1.5),
    machine_per_hr: n(rates.machine_per_hr),
    indirect_pct: n(rates.indirect_pct),
  };
  const totalOperators = n(plan.totalOperators);
  const totalMachines = n(plan.totalMachines);
  const sh = Math.max(0, n(shiftHours));
  const ot = Math.max(0, n(overtimeHours));

  const labourCost = totalOperators * sh * r.labour_per_hr;
  const overtimeCost = totalOperators * ot * r.labour_per_hr * r.overtime_multiplier;
  const machineCost = totalMachines * (sh + ot) * r.machine_per_hr;
  const direct = labourCost + overtimeCost + machineCost;
  const total = direct * (1 + r.indirect_pct);
  const targetQty = n(plan.targetQty);
  const costPerPc = targetQty > 0 ? total / targetQty : 0;

  return {
    labourCost: +labourCost.toFixed(2),
    overtimeCost: +overtimeCost.toFixed(2),
    machineCost: +machineCost.toFixed(2),
    total: +total.toFixed(2),
    costPerPc: +costPerPc.toFixed(3),
  };
}

const costModel = { planCost };
export default costModel;

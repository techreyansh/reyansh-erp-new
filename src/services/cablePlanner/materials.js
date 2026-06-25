// Raw-material consumption — copper, PVC insulation, PVC sheath (kg).
// Ported verbatim from the planner's estimateRM() (Reyansh_Cable_Planner.html).
import { CONST, layingMultiplier } from "./machineConfig.js";

// Per-metre RM for a cable: { copper, ins, sh } in kg/m.
export function perMeterRM(cable) {
  const cores = cable.cores || 1;
  const size = cable.size || 1;
  const insThick = cable.insThick || 0.6;
  // Preserve an EXPLICIT shThick of 0 (no sheath); only an absent field defaults
  // to 0.9. `|| 0.9` wrongly turned 0 into 0.9, which (with the old AND below)
  // mis-costed single-core sheathed cables. Matches the scheduler's `|| 0`.
  const shThick = cable.shThick != null ? cable.shThick : 0.9;

  // Copper: size(sqmm) × density-factor × cores × loss factor
  const copper = size * CONST.COPPER_DENSITY_FACTOR * cores * CONST.COPPER_LOSS;

  // Insulation PVC (annulus around each conductor, × cores)
  const cd = Math.sqrt(size / Math.PI) * 2;     // conductor dia (mm)
  const insOd = cd + 2 * insThick;
  const insAreaCC = (Math.PI * (insOd * insOd - cd * cd)) / 4 / 100; // cm² per 1 m
  const ins = (insAreaCC * 100 * CONST.PVC_DENSITY) / 1000 * cores;

  // Sheath PVC (annulus around the laid bundle) — present when the cable has a
  // sheath: multi-core OR an explicit sheath thickness (incl. 1C sheathed cables).
  // Same condition as requiredStages() so schedule and materials always agree.
  let sh = 0;
  if (cores >= CONST.SHEATH_TRIGGER_CORES || shThick > 0) {
    const layingOd = insOd * layingMultiplier(cores);
    const shOd = layingOd + 2 * shThick;
    const shAreaCC = (Math.PI * (shOd * shOd - layingOd * layingOd)) / 4 / 100;
    sh = (shAreaCC * 100 * CONST.PVC_DENSITY) / 1000;
  }
  return { copper, ins, sh };
}

// Total RM for a quantity of finished metres.
export function estimateRM(cable, qtyMeters) {
  const pm = perMeterRM(cable);
  const q = qtyMeters || 0;
  return { copper: pm.copper * q, ins: pm.ins * q, sh: pm.sh * q };
}

// Sum RM across many (cable, qty) pairs — for stock pre-checks.
export function sumRM(items) {
  return items.reduce(
    (acc, { cable, qtyMeters }) => {
      const r = estimateRM(cable, qtyMeters);
      acc.copper += r.copper; acc.ins += r.ins; acc.sh += r.sh;
      return acc;
    },
    { copper: 0, ins: 0, sh: 0 }
  );
}

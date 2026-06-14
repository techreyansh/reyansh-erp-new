// Cable geometry — OD build-up chain. Ported verbatim from the planner's
// jobSpecs() geometry (Reyansh_Cable_Planner.html).
//   conductor OD → (+2·insThick) insulated-core OD → (×laying multiplier)
//   laid-up bundle OD → (+2·shThick) finished outer OD.
import { layingMultiplier } from "./machineConfig.js";

// sqmm area → equivalent circle diameter (mm).
export function conductorDia(sizeSqmm) {
  return Math.sqrt((sizeSqmm || 0) / Math.PI) * 2;
}

export function cableGeometry(cable) {
  const size = cable.size || 1;
  const cores = cable.cores || 1;
  const cd = +(conductorDia(size)).toFixed(2);
  const insOd = +(cd + 2 * (cable.insThick || 0)).toFixed(2);
  const lm = layingMultiplier(cores);
  const laidOd = cores >= 2 ? +(insOd * lm).toFixed(2) : insOd;
  const outerOd = cable.shThick ? +(laidOd + 2 * cable.shThick).toFixed(2) : laidOd;
  // lay lengths (mm): bunch ≈ 16× conductor dia, laying ≈ 14× laid OD
  const bunchLayLength = +(cd * 16).toFixed(0);
  const layLength = cores >= 3 ? +(laidOd * 14).toFixed(0) : 0;
  return { conductorDia: cd, insOd, laidOd, outerOd, bunchLayLength, layLength, layingMultiplier: lm };
}

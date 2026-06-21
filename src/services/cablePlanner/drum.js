// Drum planning (Cable Production Planning — Phase 3).
// "Can this length fit on a drum?" + multi-drum split per stage, using the drum
// capacities held on the Machine Master (drum/core/laying-drum capacity in m).
// Pure functions; no React, no DB.
import { requiredStages, computeStagePlan } from "./scheduler.js";
import { coreColorsFor, STAGE_LABEL } from "./machineConfig.js";

// Split a wound length across drums of a given capacity. capacity ≤ 0/unknown →
// a single drum with the whole length and fits=null (capacity not configured).
export function splitAcrossDrums(lengthM, capacityM) {
  const L = Math.max(0, Number(lengthM) || 0);
  const cap = Number(capacityM) || 0;
  if (cap <= 0) {
    return { drumCount: null, drums: [{ index: 1, lengthM: +L.toFixed(1) }], capacityM: null, fits: null };
  }
  const full = Math.floor(L / cap);
  const rem = +(L - full * cap).toFixed(1);
  const drums = [];
  for (let i = 0; i < full; i++) drums.push({ index: i + 1, lengthM: +cap.toFixed(1) });
  if (rem > 0.05) drums.push({ index: drums.length + 1, lengthM: rem });
  if (drums.length === 0) drums.push({ index: 1, lengthM: 0 });
  return { drumCount: drums.length, drums, capacityM: cap, fits: L <= cap };
}

// The drum capacity that applies to a stage, read from that stage's machine.
export function stageDrumCapacity(stage, machine) {
  if (!machine) return null;
  if (stage === "core") return machine.coreCapacityM ?? machine.drumCapacityM ?? null;
  if (stage === "laying") return machine.layingDrumCapacityM ?? machine.drumCapacityM ?? null;
  return machine.drumCapacityM ?? null; // bunching, sheathing, cutting
}

// Full drum plan for an order across its required stages. Per-core stages (core
// extrusion) wind one set of drums per colour, so totalDrums = drumsPerCore×cores.
export function orderDrumPlan(cable, order, machines = []) {
  const stages = requiredStages(cable);
  const plan = computeStagePlan(cable, order, machines);
  const byStage = {};
  for (const m of machines) byStage[m.stage] = m;
  const colors = coreColorsFor(cable);

  return stages.map((sd) => {
    const m = byStage[sd.stage];
    const cap = stageDrumCapacity(sd.stage, m);
    const outPerRun = plan[sd.stage].output;
    const split = splitAcrossDrums(outPerRun, cap);
    if (sd.perCore) {
      return {
        stage: sd.stage, label: STAGE_LABEL[sd.stage] || sd.stage, machine: m?.name || null,
        perCore: true, cores: colors.length, capacityM: cap, lengthPerCoreM: +outPerRun.toFixed(1),
        drumsPerCore: split.drumCount,
        totalDrums: split.drumCount == null ? null : split.drumCount * colors.length,
        fits: split.fits, drums: split.drums,
      };
    }
    return {
      stage: sd.stage, label: STAGE_LABEL[sd.stage] || sd.stage, machine: m?.name || null,
      perCore: false, cores: 1, capacityM: cap, lengthM: +outPerRun.toFixed(1),
      totalDrums: split.drumCount, fits: split.fits, drums: split.drums,
    };
  });
}

// Bridges Machine Master rows (public.ppc_machines, the seeded M1–M4 + any the
// user adds) to the pure scheduler-engine machine shape consumed by
// runAutoSchedule / analytics. Keeps the engine ignorant of the DB schema.
//
// Engine machine shape (see machineConfig.DEFAULT_MACHINES):
//   { id, name, stage, shiftStartHour, shiftHrs, daysPerWeek, changeoverMin,
//     defaultSpeed, scrapPct, layReductionPct }   (+ drum capacities for drum planning)
import { DEFAULT_MACHINES, STAGE_ORDER } from "./machineConfig.js";

const num = (v, d) => {
  if (v === null || v === undefined || v === "") return d;
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

// One ppc_machines row → one engine machine. Engine id prefers the human code
// ("M1"…) so it stays stable and matches saved Machine-Schedule rows.
export function dbMachineToEngine(row) {
  if (!row) return null;
  return {
    id: row.code || String(row.id),
    dbId: row.id,
    name: row.name || row.code || "Machine",
    stage: row.stage || null,
    shiftStartHour: num(row.shift_start_hour, 9),
    shiftHrs: num(row.shift_hours, 8),
    daysPerWeek: num(row.days_per_week, 6),
    changeoverMin: num(row.changeover_min, 0),
    defaultSpeed: num(row.speed_m_per_hr, 500),
    scrapPct: num(row.scrap_pct, 0),
    layReductionPct: num(row.lay_reduction_pct, 0),
    // drum / capacity (used by Phase 3 drum planning)
    drumCapacityM: num(row.drum_capacity_m, null),
    coreCapacityM: num(row.core_capacity_m, null),
    layingDrumCapacityM: num(row.laying_drum_capacity_m, null),
    isAvailable: row.is_available !== false,
  };
}

// A list of ppc_machines rows → engine machines, one per pipeline stage in
// STAGE_ORDER. Only available machines are considered; if a stage has several
// available machines the first (lowest code) wins (the engine schedules one
// machine per stage). Any stage with no DB machine falls back to its
// DEFAULT_MACHINES entry, so the engine always has a complete 4-stage pipeline.
export function toEngineMachines(rows = []) {
  const mapped = rows.map(dbMachineToEngine).filter((m) => m && m.isAvailable && m.stage);
  const byStage = {};
  for (const m of mapped) if (!byStage[m.stage]) byStage[m.stage] = m;
  return STAGE_ORDER.map((stage) => byStage[stage] || DEFAULT_MACHINES.find((d) => d.stage === stage)).filter(Boolean);
}

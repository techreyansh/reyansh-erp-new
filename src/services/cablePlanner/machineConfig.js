// Cable planner — machine model + constants.
// Ported from Reyansh_Cable_Planner.html (the 4-machine bunching→core→laying→
// sheathing pipeline). Pure data/config; no React, no Supabase.

export const STAGE_ORDER = ["bunching", "core", "laying", "sheathing"];

export const STAGE_LABEL = {
  bunching: "Bunching",
  core: "Core Ext",
  laying: "Laying",
  sheathing: "Sheathing",
};

// The four machines, one per pipeline stage. shiftStartHour + shiftHrs define
// the daily working window; daysPerWeek=6 skips Sundays, 5 skips Sat+Sun.
// scrapPct = % of input lost at this stage; layReductionPct compresses length
// during laying-up (laying only). defaultSpeed in metres/hour.
export const DEFAULT_MACHINES = [
  { id: "M1", name: "Bunching M/C",       stage: "bunching",  shiftStartHour: 9, shiftHrs: 8, daysPerWeek: 6, changeoverMin: 30, defaultSpeed: 500, scrapPct: 2, layReductionPct: 0 },
  { id: "M2", name: "Core Extruder",      stage: "core",      shiftStartHour: 9, shiftHrs: 8, daysPerWeek: 6, changeoverMin: 45, defaultSpeed: 700, scrapPct: 3, layReductionPct: 0 },
  { id: "M3", name: "Laying M/C",         stage: "laying",    shiftStartHour: 9, shiftHrs: 8, daysPerWeek: 6, changeoverMin: 30, defaultSpeed: 600, scrapPct: 1, layReductionPct: 2 },
  { id: "M4", name: "Sheathing Extruder", stage: "sheathing", shiftStartHour: 9, shiftHrs: 8, daysPerWeek: 6, changeoverMin: 60, defaultSpeed: 500, scrapPct: 5, layReductionPct: 0 },
];

// Default core-colour sets by core count (used when a cable has none defined).
export const DEFAULT_CORE_COLORS = {
  1: ["Red"],
  2: ["Red", "Black"],
  3: ["Red", "Yellow", "Blue"],
  4: ["Red", "Yellow", "Blue", "Black"],
  5: ["Red", "Yellow", "Blue", "Black", "Green-Yellow"],
};
const FALLBACK_COLORS = ["Red", "Yellow", "Blue", "Black", "Green-Yellow", "Brown", "Grey", "White"];

export const COMMON_CORE_COLORS = [
  "Red", "Yellow", "Blue", "Black", "Green", "Green-Yellow",
  "Brown", "Grey", "White", "Orange", "Purple", "Pink",
];

// Physical constants used by the material/geometry formulas.
export const CONST = {
  COPPER_DENSITY_FACTOR: 0.00896, // kg per (sqmm·m): 8.96 g/cc ÷ 1000
  COPPER_LOSS: 1.04,              // +4% copper wastage
  PVC_DENSITY: 1.4,              // g/cc, insulation & sheath
  BUNCH_TRIGGER_STRANDS: 24,     // bunching runs only if strandCount ≥ this
  LAYING_TRIGGER_CORES: 3,       // laying runs only if cores ≥ this
  SHEATH_TRIGGER_CORES: 2,       // sheath material counted only if cores ≥ this
  PRIORITY_RANK: { high: 0, normal: 1, low: 2 },
  DEFAULT_BATCH_WINDOW_DAYS: 7,
};

// Bundle-OD multiplier vs a single insulated-core OD, by core count.
export function layingMultiplier(cores) {
  return cores === 2 ? 2 : cores === 3 ? 2.15 : cores === 4 ? 2.42 : cores >= 5 ? 2.7 : 1;
}

// Resolve a cable's per-core colour list (length == cores).
export function coreColorsFor(cable) {
  const cores = cable.cores || 1;
  if (Array.isArray(cable.coreColors) && cable.coreColors.length >= cores) {
    return cable.coreColors.slice(0, cores);
  }
  const base = DEFAULT_CORE_COLORS[cores] || FALLBACK_COLORS;
  const out = [];
  for (let i = 0; i < cores; i++) out.push(base[i] || `Core ${i + 1}`);
  return out;
}

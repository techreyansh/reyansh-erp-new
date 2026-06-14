/**
 * PPC Planning Engine — native port of the Reyansh Cable Planner logic.
 *
 * Pure, framework-agnostic functions (no React, no Supabase) so the production
 * planning "brain" is testable in isolation and reusable across UI + services.
 *
 * Domain: a PVC cable / power-cord manufacturer. A finished cable is produced in
 * up to four sequential stages, one machine each:
 *   1. Bunching   — twist bare copper strands into a stranded conductor
 *   2. Core       — PVC-insulate each conductor (one run per core colour)
 *   3. Laying     — twist cores into a bundle (only for 3+ cores)
 *   4. Sheathing  — extrude the outer PVC jacket (cords are auto-cut here)
 *
 * Quantities cascade BACKWARD from the customer's finished metres: each stage's
 * input = its output / (1 − scrap%), so upstream stages over-produce to absorb
 * yield loss. Scheduling walks each order's stage chain across the machines,
 * honouring shift windows, the working week, and changeover time.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const STAGE_ORDER = ["bunching", "core", "laying", "sheathing"];

export const STAGE_LABEL = {
  bunching: "Bunching",
  core: "Core Extrusion",
  laying: "Laying-up",
  sheathing: "Sheathing",
};

export const STAGE_COLOR = {
  bunching: "#1E7DBE",
  core: "#059669",
  laying: "#D97706",
  sheathing: "#DC2626",
};

// Material densities / allowances (see in-app reference panel).
const CU_KG_PER_SQMM_M = 0.00896; // copper: 8.96 g/cm³
const PVC_KG_PER_MM2_M = 0.0014; // PVC: 1.4 g/cm³
const BUNCH_ALLOWANCE = 1.04; // +4% for strand bunching
// Laying multiplier by core count (laid-up OD = ins OD × multiplier).
const LAY_MULTIPLIER = { 2: 2.0, 3: 2.15, 4: 2.42, 5: 2.7 };

export const DEFAULT_CORE_COLORS = {
  1: ["Red"],
  2: ["Red", "Black"],
  3: ["Red", "Yellow", "Blue"],
  4: ["Red", "Yellow", "Blue", "Black"],
  5: ["Red", "Yellow", "Blue", "Black", "Green-Yellow"],
};

/** The four fixed machines, one per stage (matches the source app defaults). */
export function defaultMachines() {
  return [
    { id: "M1", name: "Bunching Machine", stage: "bunching", shiftStartHour: 9, shiftHrs: 8, daysPerWeek: 6, changeoverMin: 20, defaultSpeed: 500, scrapPct: 2, layReductionPct: 0, currentOperator: "" },
    { id: "M2", name: "Core Extruder", stage: "core", shiftStartHour: 9, shiftHrs: 8, daysPerWeek: 6, changeoverMin: 30, defaultSpeed: 700, scrapPct: 3, layReductionPct: 0, currentOperator: "" },
    { id: "M3", name: "Laying-up Machine", stage: "laying", shiftStartHour: 9, shiftHrs: 8, daysPerWeek: 6, changeoverMin: 25, defaultSpeed: 600, scrapPct: 1, layReductionPct: 2, currentOperator: "" },
    { id: "M4", name: "Sheathing Line", stage: "sheathing", shiftStartHour: 9, shiftHrs: 8, daysPerWeek: 6, changeoverMin: 20, defaultSpeed: 500, scrapPct: 5, layReductionPct: 0, currentOperator: "" },
  ];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const keep = (frac) => 1 - frac; // yield-keep fraction
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function cableDescr(c) {
  if (!c) return "";
  return `${num(c.cores)}C × ${num(c.size)} sqmm ${c.type || ""} (${c.color || "-"})`.replace(/\s+/g, " ").trim();
}

export function coreColorsFor(cable) {
  if (Array.isArray(cable?.coreColors) && cable.coreColors.length) return cable.coreColors;
  return DEFAULT_CORE_COLORS[num(cable?.cores, 1)] || DEFAULT_CORE_COLORS[1];
}

// ---------------------------------------------------------------------------
// Cable geometry → raw-material estimate (copper / insulation / sheath kg)
// ---------------------------------------------------------------------------
/**
 * estimateRM(cable, qtyMeters) → { copper, ins, sh } kilograms.
 * Faithful port of the app's estimateRM() geometry.
 */
export function estimateRM(cable, qtyMeters) {
  const qty = num(qtyMeters);
  const size = num(cable.size);
  const cores = num(cable.cores, 1);
  const insThick = num(cable.insThick);
  const shThick = num(cable.shThick);

  const copperKgPerM = size * CU_KG_PER_SQMM_M * cores * BUNCH_ALLOWANCE;

  const conductorDia = Math.sqrt(size / Math.PI) * 2;
  const insOd = conductorDia + 2 * insThick;
  // (π/4)(D² − d²) in mm² × density → kg/m, per core
  const insKgPerM = (Math.PI / 4) * (insOd * insOd - conductorDia * conductorDia) * PVC_KG_PER_MM2_M * cores;

  let shKgPerM = 0;
  if (cores >= 2 && shThick > 0) {
    const mult = LAY_MULTIPLIER[cores] || 2.7;
    const layingOd = insOd * mult;
    const shOd = layingOd + 2 * shThick;
    shKgPerM = (Math.PI / 4) * (shOd * shOd - layingOd * layingOd) * PVC_KG_PER_MM2_M;
  }

  return {
    copper: copperKgPerM * qty,
    ins: insKgPerM * qty,
    sh: shKgPerM * qty,
  };
}

// ---------------------------------------------------------------------------
// Which stages a cable needs, and the backward quantity cascade
// ---------------------------------------------------------------------------
/** requiredStages(cable) → ordered list of stages this cable passes through. */
export function requiredStages(cable) {
  const cores = num(cable.cores, 1);
  const strandCount = num(cable.strandCount);
  const stages = [];
  if (strandCount >= 24) stages.push("bunching"); // solid wire skips bunching
  stages.push("core");
  if (cores >= 3) stages.push("laying");
  stages.push("sheathing");
  return stages;
}

/**
 * computeStagePlan(cable, order, machinesByStage) → per-stage input/output metres.
 * Works backward from finished metres Q (= sheathing output).
 */
export function computeStagePlan(cable, order, machinesByStage) {
  const Q = num(order.qtyM);
  const cores = num(cable.cores, 1);
  const stages = requiredStages(cable);
  const has = (s) => stages.includes(s);
  const scrap = (s) => num(machinesByStage[s]?.scrapPct) / 100;
  const layRed = num(machinesByStage.laying?.layReductionPct) / 100;

  const sheathOut = Q;
  const sheathIn = sheathOut / keep(scrap("sheathing"));

  let layingOut = null;
  let perCoreOut;
  if (has("laying")) {
    layingOut = sheathIn;
    perCoreOut = layingOut / keep(scrap("laying")) / keep(layRed);
  } else {
    perCoreOut = sheathIn; // cores feed sheathing directly
  }

  const coreOutPerColor = perCoreOut;
  const coreInPerColor = coreOutPerColor / keep(scrap("core"));

  let bunchOut = null;
  let bunchIn = null;
  if (has("bunching")) {
    bunchOut = cores * coreInPerColor;
    bunchIn = bunchOut / keep(scrap("bunching"));
  }

  return {
    stages,
    bunching: has("bunching") ? { output: bunchOut, input: bunchIn } : null,
    core: { output: coreOutPerColor, input: coreInPerColor, perColor: true },
    laying: has("laying") ? { output: layingOut, input: perCoreOut } : null,
    sheathing: { output: sheathOut, input: sheathIn },
  };
}

export function estimateOrderDuration(cable, order, machines, speeds) {
  const byStage = machinesByStage(machines);
  const plan = computeStagePlan(cable, order, byStage);
  const colors = coreColorsFor(cable);
  let hrs = 0;
  for (const stage of plan.stages) {
    const m = byStage[stage];
    const jobs = stage === "core" ? colors.length : 1;
    const outM = stage === "core" ? plan.core.output : plan[stage].output;
    const speed = getSpeed(speeds, cable.id, m.id, m.defaultSpeed);
    hrs += jobs * (outM / speed + num(m.changeoverMin) / 60);
  }
  return hrs;
}

// ---------------------------------------------------------------------------
// Speeds + machine lookup
// ---------------------------------------------------------------------------
export function getSpeed(speeds, cableId, machineId, fallback = 500) {
  const hit = (speeds || []).find((s) => s.cableId === cableId && s.machineId === machineId);
  return num(hit?.speedMHr, fallback) || fallback;
}

export function machinesByStage(machines) {
  const map = {};
  (machines || []).forEach((m) => { map[m.stage] = m; });
  return map;
}

// ---------------------------------------------------------------------------
// Business-hours calendar (shift window + working week)
// ---------------------------------------------------------------------------
function isWorkingDay(date, daysPerWeek) {
  const dow = date.getDay(); // 0 = Sun, 6 = Sat
  if (num(daysPerWeek) >= 7) return true;
  if (num(daysPerWeek) === 6) return dow !== 0; // skip Sunday
  return dow !== 0 && dow !== 6; // 5-day: skip Sat + Sun
}

function workingStart(date, machine) {
  const d = new Date(date);
  d.setHours(num(machine.shiftStartHour, 9), 0, 0, 0);
  let guard = 0;
  while (!isWorkingDay(d, machine.daysPerWeek) && guard++ < 30) d.setDate(d.getDate() + 1);
  return d;
}

/** addBusinessHours — walk forward through shift windows, skipping non-working days. */
export function addBusinessHours(start, hours, machine) {
  const shiftStart = num(machine.shiftStartHour, 9);
  const shiftHrs = num(machine.shiftHrs, 8);
  const shiftEnd = shiftStart + shiftHrs;
  let cur = new Date(start);
  let remaining = hours;
  let guard = 0;

  // Snap into a valid working window.
  if (cur.getHours() < shiftStart) cur.setHours(shiftStart, 0, 0, 0);
  while ((!isWorkingDay(cur, machine.daysPerWeek) || cur.getHours() >= shiftEnd) && guard++ < 5000) {
    cur.setDate(cur.getDate() + 1);
    cur.setHours(shiftStart, 0, 0, 0);
  }

  guard = 0;
  while (remaining > 1e-9 && guard++ < 5000) {
    if (!isWorkingDay(cur, machine.daysPerWeek)) {
      cur.setDate(cur.getDate() + 1); cur.setHours(shiftStart, 0, 0, 0); continue;
    }
    const dayEnd = new Date(cur); dayEnd.setHours(shiftEnd, 0, 0, 0);
    const availMs = dayEnd - cur;
    const availHrs = availMs / 3600000;
    if (availHrs <= 0) { cur.setDate(cur.getDate() + 1); cur.setHours(shiftStart, 0, 0, 0); continue; }
    if (remaining <= availHrs) { cur = new Date(cur.getTime() + remaining * 3600000); remaining = 0; }
    else { remaining -= availHrs; cur = new Date(dayEnd); cur.setDate(cur.getDate() + 1); cur.setHours(shiftStart, 0, 0, 0); }
  }
  return cur;
}

/** subtractBusinessHours — walk backward (for reverse / due-date planning). */
export function subtractBusinessHours(end, hours, machine) {
  const shiftStart = num(machine.shiftStartHour, 9);
  const shiftHrs = num(machine.shiftHrs, 8);
  const shiftEnd = shiftStart + shiftHrs;
  let cur = new Date(end);
  let remaining = hours;
  let guard = 0;

  if (cur.getHours() > shiftEnd) cur.setHours(shiftEnd, 0, 0, 0);
  while ((!isWorkingDay(cur, machine.daysPerWeek) || cur.getHours() <= shiftStart) && guard++ < 5000) {
    cur.setDate(cur.getDate() - 1);
    cur.setHours(shiftEnd, 0, 0, 0);
  }

  guard = 0;
  while (remaining > 1e-9 && guard++ < 5000) {
    if (!isWorkingDay(cur, machine.daysPerWeek)) {
      cur.setDate(cur.getDate() - 1); cur.setHours(shiftEnd, 0, 0, 0); continue;
    }
    const dayStart = new Date(cur); dayStart.setHours(shiftStart, 0, 0, 0);
    const availHrs = (cur - dayStart) / 3600000;
    if (availHrs <= 0) { cur.setDate(cur.getDate() - 1); cur.setHours(shiftEnd, 0, 0, 0); continue; }
    if (remaining <= availHrs) { cur = new Date(cur.getTime() - remaining * 3600000); remaining = 0; }
    else { remaining -= availHrs; cur = dayStart; cur.setDate(cur.getDate() - 1); cur.setHours(shiftEnd, 0, 0, 0); }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Auto-scheduler
// ---------------------------------------------------------------------------
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
let _jid = 0;
const jobId = () => `job_${Date.now().toString(36)}_${(_jid++).toString(36)}`;

/**
 * runAutoSchedule(orders, cablesById, machines, speeds, settings)
 *   → { schedule: job[], missedDue: orderId[] }
 *
 * settings: { startDate, priority:'due_date'|'manual'|'fifo', scope:'pending'|'all',
 *             mode:'forward'|'reverse' }
 */
export function runAutoSchedule(orders, cablesById, machines, speeds, settings = {}) {
  const startDate = startOfDay(settings.startDate || new Date());
  const priority = settings.priority || "due_date";
  const scope = settings.scope || "pending";
  const mode = settings.mode || "reverse";
  const byStage = machinesByStage(machines);

  let pool = (orders || []).filter((o) => o.status !== "completed");
  if (scope === "pending") pool = pool.filter((o) => o.status === "pending" || !o.status);

  pool = pool.slice().sort((a, b) => {
    if (priority === "fifo") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    if (priority === "manual") {
      const r = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
      return r !== 0 ? r : new Date(a.dueDate || 0) - new Date(b.dueDate || 0);
    }
    return new Date(a.dueDate || 0) - new Date(b.dueDate || 0);
  });

  const machineAvail = {};
  machines.forEach((m) => { machineAvail[m.id] = workingStart(startDate, m); });
  const lastSpec = {}; // machineId → spec key (for changeover detection)

  const schedule = [];
  const missedDue = [];

  for (const order of pool) {
    const cable = cablesById[order.cableId];
    if (!cable) continue;
    const plan = computeStagePlan(cable, order, byStage);
    const colors = coreColorsFor(cable);

    // Reverse mode: anchor the chain so sheathing finishes by the due date.
    let prevEnd = null;
    if (mode === "reverse" && order.dueDate) {
      const totalHrs = estimateOrderDuration(cable, order, machines, speeds);
      const sheathM = byStage.sheathing;
      const dueEnd = new Date(order.dueDate); dueEnd.setHours(num(sheathM.shiftStartHour, 9) + num(sheathM.shiftHrs, 8), 0, 0, 0);
      let targetStart = subtractBusinessHours(dueEnd, totalHrs, sheathM);
      if (targetStart < startDate) targetStart = workingStart(startDate, byStage[plan.stages[0]]);
      prevEnd = targetStart;
    }

    for (const stage of plan.stages) {
      const m = byStage[stage];
      const speed = getSpeed(speeds, cable.id, m.id, m.defaultSpeed);
      const specBase = `${num(cable.size)}|${cable.color || ""}`;

      if (stage === "core") {
        const ends = [];
        colors.forEach((color, idx) => {
          const outM = plan.core.output;
          const hrs = outM / speed;
          const spec = `${specBase}|${color}`;
          const change = lastSpec[m.id] && lastSpec[m.id] !== spec ? num(m.changeoverMin) / 60 : 0;
          const earliest = idx === 0 && prevEnd ? new Date(Math.max(machineAvail[m.id], prevEnd)) : new Date(machineAvail[m.id]);
          const startT = addBusinessHours(earliest, change, m);
          const endT = addBusinessHours(startT, hrs, m);
          schedule.push(makeJob(order, cable, m, stage, { coreIndex: idx + 1, coreColor: color, coreOfTotal: colors.length, startTime: startT, endTime: endT, plannedHrs: hrs, changeoverHrs: change, plannedM: outM, plannedInputM: plan.core.input }));
          machineAvail[m.id] = endT;
          lastSpec[m.id] = spec;
          ends.push(endT);
        });
        prevEnd = new Date(Math.max(...ends.map((d) => d.getTime())));
      } else {
        const node = plan[stage];
        const outM = node.output;
        const hrs = outM / speed;
        const change = lastSpec[m.id] && lastSpec[m.id] !== specBase ? num(m.changeoverMin) / 60 : 0;
        const earliest = prevEnd ? new Date(Math.max(machineAvail[m.id], prevEnd)) : new Date(machineAvail[m.id]);
        const startT = addBusinessHours(earliest, change, m);
        const endT = addBusinessHours(startT, hrs, m);
        schedule.push(makeJob(order, cable, m, stage, { startTime: startT, endTime: endT, plannedHrs: hrs, changeoverHrs: change, plannedM: outM, plannedInputM: node.input }));
        machineAvail[m.id] = endT;
        lastSpec[m.id] = specBase;
        prevEnd = endT;
      }
    }

    // Missed-due check: did sheathing finish after the due date?
    if (order.dueDate) {
      const sheathJobs = schedule.filter((j) => j.orderId === order.id && j.stage === "sheathing");
      const lastEnd = sheathJobs.reduce((mx, j) => Math.max(mx, new Date(j.endTime).getTime()), 0);
      const dueEnd = new Date(order.dueDate); dueEnd.setHours(23, 59, 59, 0);
      if (lastEnd > dueEnd.getTime()) missedDue.push(order.id);
    }
  }

  return { schedule, missedDue };
}

function makeJob(order, cable, machine, stage, fields) {
  return {
    id: jobId(),
    orderId: order.id,
    cableId: cable.id,
    machineId: machine.id,
    stage,
    coreIndex: fields.coreIndex ?? null,
    coreColor: fields.coreColor ?? null,
    coreOfTotal: fields.coreOfTotal ?? null,
    startTime: fields.startTime.toISOString(),
    endTime: fields.endTime.toISOString(),
    plannedHrs: round2(fields.plannedHrs),
    changeoverHrs: round2(fields.changeoverHrs || 0),
    orderM: num(order.qtyM),
    plannedM: Math.round(fields.plannedM),
    plannedInputM: Math.round(fields.plannedInputM),
    actualM: null,
    actualStartTime: null,
    actualEndTime: null,
    scrapM: null,
    operatorNote: "",
    status: "planned",
  };
}

// ---------------------------------------------------------------------------
// Risk, load, burn-down
// ---------------------------------------------------------------------------
/** orderRiskScore(order, schedule) → 0..>100. Higher = more at risk. */
export function orderRiskScore(order, schedule = []) {
  if (order.status === "completed") return -1;
  if (!order.dueDate) return 0;
  const daysToDue = Math.floor((startOfDay(order.dueDate) - startOfDay(new Date())) / 86400000);
  const jobs = schedule.filter((j) => j.orderId === order.id);
  const total = jobs.length;
  const done = jobs.filter((j) => j.status === "completed").length;
  const planned = total > 0;
  const progress = total > 0 ? done / total : 0;

  if (daysToDue < 0) return 100 + Math.abs(daysToDue);
  if (daysToDue <= 1 && !planned) return 95;
  if (daysToDue <= 1 && progress < 0.5) return 90;
  if (daysToDue <= 2 && progress < 0.25) return 75;
  if (daysToDue <= 5 && !planned) return 60;
  if (daysToDue <= 5 && progress < 0.25) return 45;
  return Math.max(0, 30 - daysToDue);
}

export function riskLevel(score) {
  if (score >= 90) return "critical";
  if (score >= 60) return "warn";
  if (score >= 30) return "watch";
  return "ok";
}

/** machineLoadForecast(machineId, schedule, machine, days) → per-day load. */
export function machineLoadForecast(machineId, schedule, machine, days = 14) {
  const out = [];
  const base = startOfDay(new Date());
  for (let i = 0; i < days; i++) {
    const day = new Date(base); day.setDate(base.getDate() + i);
    const hrs = (schedule || [])
      .filter((j) => j.machineId === machineId && startOfDay(j.startTime).getTime() === day.getTime())
      .reduce((s, j) => s + num(j.plannedHrs) + num(j.changeoverHrs), 0);
    const capacity = isWorkingDay(day, machine?.daysPerWeek) ? num(machine?.shiftHrs, 8) : 0;
    out.push({ date: day.toISOString().slice(0, 10), hrs: round2(hrs), capacity, pct: capacity ? round2((hrs / capacity) * 100) : 0 });
  }
  return out;
}

/** rmBurndown — projected copper/ins/sheath balance, consumption bucketed by job day. */
export function rmBurndown(schedule, cablesById, stock, days = 30) {
  const base = startOfDay(new Date());
  let copper = num(stock?.copperKg);
  let ins = num(stock?.pvcInsKg);
  let sh = num(stock?.pvcShKg);
  const series = [];
  let shortageDay = null;

  for (let i = 0; i < days; i++) {
    const day = new Date(base); day.setDate(base.getDate() + i);
    const dayKey = day.getTime();
    (schedule || []).forEach((j) => {
      if (startOfDay(j.startTime).getTime() !== dayKey) return;
      const cable = cablesById[j.cableId];
      if (!cable) return;
      const rm = estimateRM(cable, num(j.plannedM));
      if (j.stage === "bunching" || j.stage === "core") copper -= rm.copper / 2; // split across the two copper-touching stages
      if (j.stage === "core") ins -= rm.ins;
      if (j.stage === "sheathing") sh -= rm.sh;
    });
    if (shortageDay === null && (copper < 0 || ins < 0 || sh < 0)) shortageDay = i;
    series.push({ date: day.toISOString().slice(0, 10), copper: round2(copper), ins: round2(ins), sh: round2(sh) });
  }
  return { series, shortageDay, reorderDay: shortageDay !== null ? Math.max(0, shortageDay - 2) : null };
}

/** Aggregate RM requirement vs on-hand across open orders (Materials screen). */
export function rmRequirementVsStock(orders, cablesById, stock) {
  let req = { copper: 0, ins: 0, sh: 0 };
  (orders || []).filter((o) => o.status !== "completed").forEach((o) => {
    const cable = cablesById[o.cableId];
    if (!cable) return;
    const rm = estimateRM(cable, num(o.qtyM));
    req.copper += rm.copper; req.ins += rm.ins; req.sh += rm.sh;
  });
  const mk = (required, inStock) => {
    const short = inStock - required;
    const level = short < 0 ? "short" : short < required * 0.2 ? "low" : "ok";
    return { required: round2(required), inStock: round2(inStock), short: round2(short), level };
  };
  return {
    copper: mk(req.copper, num(stock?.copperKg)),
    ins: mk(req.ins, num(stock?.pvcInsKg)),
    sh: mk(req.sh, num(stock?.pvcShKg)),
  };
}

function round2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100; }

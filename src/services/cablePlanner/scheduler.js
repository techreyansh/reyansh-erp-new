// Cable planner — the scheduling engine. Pure functions ported from the
// planner's requiredStages / computeStagePlan / runAutoSchedule.
//
// runAutoSchedule({ cables, machines, speeds, orders, options }) -> result.
// It does NOT mutate inputs and never prompts; stock block/warn is returned as
// data for the UI to act on.
import { STAGE_ORDER, CONST, coreColorsFor } from "./machineConfig.js";
import { sumRM } from "./materials.js";
import { workingStart, addBusinessHours, subtractBusinessHours } from "./time.js";

export function machinesByStage(machines) {
  const m = {};
  for (const x of machines) m[x.stage] = x;
  return m;
}
export function machineForStage(machines, stage) {
  return machines.find((x) => x.stage === stage) || null;
}
export function getSpeed(speeds, machines, cableId, machineId) {
  const e = (speeds || []).find((s) => s.cableId === cableId && s.machineId === machineId);
  if (e) return e.speedMHr;
  const m = machines.find((x) => x.id === machineId);
  return m ? m.defaultSpeed : 500;
}

// Which of the 4 stages run for a cable (and which split per core).
export function requiredStages(cable) {
  const stages = [];
  if ((cable.strandCount || 0) >= CONST.BUNCH_TRIGGER_STRANDS) {
    stages.push({ stage: "bunching", perCore: false });
  }
  stages.push({ stage: "core", perCore: true });
  if ((cable.cores || 0) >= CONST.LAYING_TRIGGER_CORES) {
    stages.push({ stage: "laying", perCore: false });
  }
  stages.push({ stage: "sheathing", perCore: false });
  return stages;
}

// Backward meters cascade: customer qty = sheathing OUTPUT; each stage INPUT =
// OUTPUT / (1 − scrap%); laying additionally divides by (1 − layReduction).
// NB (ported quirk): laying scrap/layReduction factors apply to the chain even
// when laying isn't a required stage (cores < 3) — faithful to the source.
export function computeStagePlan(cable, order, machines) {
  const mbs = machinesByStage(machines);
  const Q = order.qtyM || 0;
  const cores = cable.cores || 1;
  const scrap = (stage) => (mbs[stage]?.scrapPct ?? 0) / 100;
  const layRed = (mbs.laying?.layReductionPct ?? 0) / 100;

  const sheathOut = Q;
  const sheathIn = sheathOut / (1 - scrap("sheathing"));
  const layingOut = sheathIn;
  const layingInPerCore = layingOut / (1 - scrap("laying")) / (1 - layRed);
  const coreOutPerColor = layingInPerCore;
  const coreInPerColor = coreOutPerColor / (1 - scrap("core"));
  const bunchOut = cores * coreInPerColor;
  const bunchIn = bunchOut / (1 - scrap("bunching"));

  return {
    bunching:  { input: bunchIn,        output: bunchOut,        perCore: false, qtyForJob: bunchOut },
    core:      { input: coreInPerColor, output: coreOutPerColor, perCore: true,  qtyForJob: coreOutPerColor },
    laying:    { input: layingInPerCore, output: layingOut,      perCore: false, qtyForJob: layingOut },
    sheathing: { input: sheathIn,       output: sheathOut,       perCore: false, qtyForJob: sheathOut },
  };
}

// Total working hours through all required stages (for reverse scheduling).
export function estimateOrderDuration(cable, order, machines, speeds) {
  const stages = requiredStages(cable);
  const plan = computeStagePlan(cable, order, machines);
  const colors = coreColorsFor(cable);
  let total = 0;
  for (const sd of stages) {
    const m = machineForStage(machines, sd.stage);
    if (!m) continue;
    const speed = getSpeed(speeds, machines, cable.id, m.id);
    const jobs = sd.perCore ? colors.length : 1;
    total += (plan[sd.stage].qtyForJob / speed) * jobs;
    total += (m.changeoverMin / 60) * jobs;
  }
  return total;
}

function sortOrders(orders, priority) {
  const arr = [...orders];
  if (priority === "due_date") {
    arr.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
  } else if (priority === "manual") {
    arr.sort((a, b) => {
      const r = (CONST.PRIORITY_RANK[a.priority] ?? 1) - (CONST.PRIORITY_RANK[b.priority] ?? 1);
      return r !== 0 ? r : String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"));
    });
  } else {
    arr.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }
  return arr;
}

// Batch orders into due-date buckets, grouping identical specs adjacent to cut
// changeovers (ported from the planner's batching block).
function batchOrders(orders, cablesById, windowDays) {
  const byDue = [...orders].sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
  const buckets = [];
  for (const o of byDue) {
    const due = o.dueDate || "9999-12-31";
    let bucket = buckets.find((bk) => bk.end >= due);
    if (!bucket) {
      const start = new Date(due);
      const end = new Date(start.getTime() + (windowDays - 1) * 86400000).toISOString().slice(0, 10);
      bucket = { end, items: [] };
      buckets.push(bucket);
    }
    bucket.items.push(o);
  }
  const specKey = (o) => {
    const c = cablesById[o.cableId] || {};
    return `${c.size}|${c.cores}|${c.color}|${(c.coreColors || []).join(",")}`;
  };
  const out = [];
  for (const bk of buckets) {
    bk.items.sort((a, b) => {
      const k = specKey(a).localeCompare(specKey(b));
      return k !== 0 ? k : String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"));
    });
    out.push(...bk.items);
  }
  return out;
}

const jobId = (order, stage, coreIndex) => `${order.id}:${stage}:${coreIndex ?? 0}`;

export function runAutoSchedule({ cables, machines, speeds = [], orders, options = {} }) {
  const {
    startDate = new Date(),
    priority = "due_date",
    checkStock = "warn",
    scope = "pending",
    mode = "forward",
    batching = false,
    batchWindow = CONST.DEFAULT_BATCH_WINDOW_DAYS,
    stock = null, // { copperKg, pvcInsKg, pvcShKg }
  } = options;

  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const cablesById = Object.fromEntries(cables.map((c) => [c.id, c]));

  // 1. select orders
  let selected = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
  if (scope === "pending") selected = selected.filter((o) => o.status === "pending");

  // 2/3. order/sequence
  selected = batching && selected.length > 1
    ? batchOrders(selected, cablesById, batchWindow)
    : sortOrders(selected, priority);

  // 4. stock pre-check (data only — UI decides on block/warn)
  const required = sumRM(selected.map((o) => ({ cable: cablesById[o.cableId] || {}, qtyMeters: o.qtyM || 0 })));
  const shortfalls = [];
  if (stock) {
    if (required.copper > (stock.copperKg ?? 0)) shortfalls.push({ key: "copper", need: required.copper, have: stock.copperKg ?? 0 });
    if (required.ins > (stock.pvcInsKg ?? 0)) shortfalls.push({ key: "pvcIns", need: required.ins, have: stock.pvcInsKg ?? 0 });
    if (required.sh > (stock.pvcShKg ?? 0)) shortfalls.push({ key: "pvcSh", need: required.sh, have: stock.pvcShKg ?? 0 });
  }
  if (checkStock === "block" && shortfalls.length) {
    return { schedule: [], plannedOrderIds: [], missedDue: [], stock: { required, shortfalls }, blocked: true };
  }

  // 6. per-machine cursors
  const machineAvail = {};
  const lastJob = {};
  for (const m of machines) { machineAvail[m.id] = workingStart(start, m); lastJob[m.id] = null; }

  const schedule = [];
  const plannedOrderIds = [];
  const missedDue = [];

  // 7. slot each order, stage by stage
  for (const order of selected) {
    const cable = cablesById[order.cableId];
    if (!cable) continue;
    const stages = requiredStages(cable);
    const colors = coreColorsFor(cable);
    const plan = computeStagePlan(cable, order, machines);

    let targetStart = workingStart(start, machines[0]);
    if (mode === "reverse" && order.dueDate) {
      const totalHrs = estimateOrderDuration(cable, order, machines, speeds);
      const last = machineForStage(machines, "sheathing");
      const dueEnd = new Date(order.dueDate);
      dueEnd.setHours((last.shiftStartHour ?? 9) + (last.shiftHrs ?? 8), 0, 0, 0);
      const revStart = subtractBusinessHours(dueEnd, totalHrs, last);
      targetStart = revStart > start ? revStart : start;
    }

    let prevEnd = targetStart;
    let lastSheathEnd = null;

    for (const sd of stages) {
      const m = machineForStage(machines, sd.stage);
      const speed = getSpeed(speeds, machines, cable.id, m.id);
      const p = plan[sd.stage];
      const hoursPerJob = p.qtyForJob / speed;

      if (sd.perCore) {
        let maxEnd = null;
        for (let idx = 0; idx < colors.length; idx++) {
          const color = colors[idx];
          const lj = lastJob[m.id];
          const changeoverHrs = lj && (lj.size !== cable.size || lj.color !== color) ? m.changeoverMin / 60 : 0;
          let s0 = idx === 0 ? new Date(Math.max(machineAvail[m.id], prevEnd)) : new Date(machineAvail[m.id]);
          s0 = addBusinessHours(s0, changeoverHrs, m);
          const e0 = addBusinessHours(s0, hoursPerJob, m);
          schedule.push(makeJob(order, cable, m, sd.stage, idx + 1, color, colors.length, s0, e0, hoursPerJob, changeoverHrs, p));
          machineAvail[m.id] = e0;
          lastJob[m.id] = { size: cable.size, color };
          if (!maxEnd || e0 > maxEnd) maxEnd = e0;
        }
        prevEnd = maxEnd || prevEnd;
      } else {
        const thisColor = cable.color || "mixed";
        const lj = lastJob[m.id];
        const changeoverHrs = lj && (lj.size !== cable.size || lj.color !== thisColor) ? m.changeoverMin / 60 : 0;
        let s0 = addBusinessHours(new Date(Math.max(machineAvail[m.id], prevEnd)), changeoverHrs, m);
        const e0 = addBusinessHours(s0, hoursPerJob, m);
        schedule.push(makeJob(order, cable, m, sd.stage, null, null, null, s0, e0, hoursPerJob, changeoverHrs, p));
        machineAvail[m.id] = e0;
        lastJob[m.id] = { size: cable.size, color: thisColor };
        prevEnd = e0;
        if (sd.stage === "sheathing") lastSheathEnd = e0;
      }
    }

    plannedOrderIds.push(order.id);
    if (order.dueDate && lastSheathEnd) {
      const dueLimit = new Date(order.dueDate); dueLimit.setHours(23, 59, 59, 0);
      if (lastSheathEnd > dueLimit) missedDue.push({ orderId: order.id, orderNo: order.orderNo, endTime: lastSheathEnd.toISOString(), dueDate: order.dueDate });
    }
  }

  // keep stage order stable in the returned schedule
  schedule.sort((a, b) => new Date(a.startTime) - new Date(b.startTime) || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

  return { schedule, plannedOrderIds, missedDue, stock: { required, shortfalls }, blocked: false };
}

function makeJob(order, cable, machine, stage, coreIndex, coreColor, coreOfTotal, start, end, plannedHrs, changeoverHrs, p) {
  return {
    id: jobId(order, stage, coreIndex),
    orderId: order.id,
    cableId: cable.id,
    machineId: machine.id,
    stage,
    coreIndex,
    coreColor,
    coreOfTotal,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    plannedHrs: +plannedHrs.toFixed(3),
    changeoverHrs: +changeoverHrs.toFixed(3),
    orderM: order.qtyM || 0,
    plannedM: +p.qtyForJob.toFixed(2),
    plannedInputM: +p.input.toFixed(2),
    actualM: null,
    actualStartTime: null,
    actualEndTime: null,
    scrapM: null,
    operatorNote: "",
    status: "planned",
  };
}

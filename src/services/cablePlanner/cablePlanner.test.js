import {
  estimateRM, perMeterRM, requiredStages, computeStagePlan, runAutoSchedule,
  DEFAULT_MACHINES, coreColorsFor, CONST,
} from "./index.js";

const cable3c = {
  id: "c1", code: "R3C25", cores: 3, size: 2.5, type: "Round Flexible",
  strandCount: 50, insThick: 0.8, shThick: 1.0, color: "Black",
  coreColors: ["Red", "Yellow", "Blue"],
};
const cableSingle = { id: "c2", code: "R1C10", cores: 1, size: 1.0, strandCount: 32, insThick: 0.7, shThick: 0, color: "Red" };
const cableSolid = { id: "c3", code: "S2C15", cores: 2, size: 1.5, strandCount: 7, insThick: 0.7, shThick: 0.9, color: "Grey" };

describe("materials (estimateRM)", () => {
  test("copper = size × factor × cores × loss × length", () => {
    const rm = estimateRM(cable3c, 1000);
    expect(rm.copper).toBeCloseTo(2.5 * CONST.COPPER_DENSITY_FACTOR * 3 * CONST.COPPER_LOSS * 1000, 3);
    expect(rm.ins).toBeGreaterThan(0);
    expect(rm.sh).toBeGreaterThan(0);
  });
  test("single-core with no sheath → zero sheath kg", () => {
    expect(perMeterRM(cableSingle).sh).toBe(0);
  });
});

describe("requiredStages", () => {
  const keys = (c) => requiredStages(c).map((s) => s.stage);
  test("3-core stranded → all four stages", () => {
    expect(keys(cable3c)).toEqual(["bunching", "core", "laying", "sheathing"]);
  });
  test("single-core, no sheath → bunching + core only (R1: no phantom sheathing/laying)", () => {
    expect(keys(cableSingle)).toEqual(["bunching", "core"]);
  });
  test("solid wire (strandCount < 24) → skips bunching", () => {
    expect(keys(cableSolid)).toEqual(["core", "sheathing"]);
  });
  test("core stage is per-core, others are not", () => {
    const map = Object.fromEntries(requiredStages(cable3c).map((s) => [s.stage, s.perCore]));
    expect(map.core).toBe(true);
    expect(map.sheathing).toBe(false);
  });
});

describe("backward quantity cascade (computeStagePlan)", () => {
  test("inputs absorb scrap; bunching output covers all cores", () => {
    const plan = computeStagePlan(cable3c, { qtyM: 5000 }, DEFAULT_MACHINES);
    expect(plan.sheathing.output).toBe(5000);
    expect(plan.sheathing.input).toBeGreaterThan(5000);
    expect(plan.core.input).toBeGreaterThan(plan.core.output);
    expect(plan.bunching.output).toBeGreaterThan(plan.core.output * 2);
  });
});

describe("runAutoSchedule", () => {
  const cables = [cable3c];
  const orders = [{ id: "o1", orderNo: "ORD-0001", customer: "Acme", cableId: "c1", qtyM: 5000, dueDate: "2026-12-31", priority: "normal", status: "pending", createdAt: "2026-06-01" }];

  test("emits one job per stage, one core job per colour", () => {
    const { schedule } = runAutoSchedule({ cables, machines: DEFAULT_MACHINES, orders, options: { startDate: new Date("2026-06-15"), mode: "forward" } });
    const stages = schedule.map((j) => j.stage);
    expect(stages.filter((s) => s === "core").length).toBe(3);
    expect(stages.filter((s) => s === "bunching").length).toBe(1);
    expect(stages.filter((s) => s === "laying").length).toBe(1);
    expect(stages.filter((s) => s === "sheathing").length).toBe(1);
  });

  test("respects stage order: bunching finishes before sheathing starts", () => {
    const { schedule } = runAutoSchedule({ cables, machines: DEFAULT_MACHINES, orders, options: { startDate: new Date("2026-06-15"), mode: "forward" } });
    const bunchEnd = Math.max(...schedule.filter((j) => j.stage === "bunching").map((j) => +new Date(j.endTime)));
    const sheathStart = Math.min(...schedule.filter((j) => j.stage === "sheathing").map((j) => +new Date(j.startTime)));
    expect(sheathStart).toBeGreaterThanOrEqual(bunchEnd);
  });

  test("checkStock=block returns blocked when stock is short", () => {
    const r = runAutoSchedule({ cables, machines: DEFAULT_MACHINES, orders, options: { checkStock: "block", stock: { copperKg: 0, pvcInsKg: 0, pvcShKg: 0 } } });
    expect(r.blocked).toBe(true);
    expect(r.schedule).toHaveLength(0);
    expect(r.stock.shortfalls.length).toBeGreaterThan(0);
  });

  test("never schedules into a Sunday for a 6-day week", () => {
    const { schedule } = runAutoSchedule({ cables, machines: DEFAULT_MACHINES, orders, options: { startDate: new Date("2026-06-15"), mode: "forward" } });
    for (const j of schedule) expect(new Date(j.startTime).getDay()).not.toBe(0);
  });
});

describe("coreColorsFor", () => {
  test("uses defaults when cable has none", () => {
    expect(coreColorsFor({ cores: 2 })).toEqual(["Red", "Black"]);
  });
});

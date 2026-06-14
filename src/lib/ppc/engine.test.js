import {
  estimateRM, requiredStages, computeStagePlan, runAutoSchedule, defaultMachines,
  machinesByStage, orderRiskScore, riskLevel, coreColorsFor, addBusinessHours,
} from "./engine";

const cable3c = {
  id: "c1", code: "R3C25", cores: 3, size: 2.5, type: "Round Flexible",
  strandCount: 50, insThick: 0.8, shThick: 1.0, color: "Black",
  coreColors: ["Red", "Yellow", "Blue"], isPowerCord: false,
};
const cableSingle = { id: "c2", code: "R1C10", cores: 1, size: 1.0, strandCount: 32, insThick: 0.7, shThick: 0, color: "Red" };

describe("cable geometry (estimateRM)", () => {
  test("copper scales with size × cores × length × allowance", () => {
    const rm = estimateRM(cable3c, 1000);
    // 2.5 × 0.00896 × 3 × 1.04 × 1000
    expect(rm.copper).toBeCloseTo(2.5 * 0.00896 * 3 * 1.04 * 1000, 3);
    expect(rm.ins).toBeGreaterThan(0);
    expect(rm.sh).toBeGreaterThan(0);
  });
  test("single-core with no sheath thickness → zero sheath kg", () => {
    const rm = estimateRM(cableSingle, 1000);
    expect(rm.sh).toBe(0);
    expect(rm.copper).toBeGreaterThan(0);
  });
});

describe("required stages", () => {
  test("3-core stranded uses all four stages", () => {
    expect(requiredStages(cable3c)).toEqual(["bunching", "core", "laying", "sheathing"]);
  });
  test("single-core stranded skips laying", () => {
    expect(requiredStages(cableSingle)).toEqual(["bunching", "core", "sheathing"]);
  });
  test("solid wire (low strand count) skips bunching", () => {
    expect(requiredStages({ ...cable3c, strandCount: 7 })).toEqual(["core", "laying", "sheathing"]);
  });
});

describe("backward quantity cascade", () => {
  const byStage = machinesByStage(defaultMachines());
  test("each upstream input ≥ its output (absorbs scrap), bunching is largest", () => {
    const plan = computeStagePlan(cable3c, { qtyM: 5000 }, byStage);
    expect(plan.sheathing.output).toBe(5000);
    expect(plan.sheathing.input).toBeGreaterThan(plan.sheathing.output);
    expect(plan.core.input).toBeGreaterThan(plan.core.output);
    expect(plan.bunching.input).toBeGreaterThan(plan.bunching.output);
    // bunching feeds all cores → much larger than a single core's run
    expect(plan.bunching.output).toBeGreaterThan(plan.core.output * 2);
  });
});

describe("auto-scheduler", () => {
  const machines = defaultMachines();
  const cablesById = { c1: cable3c };
  const orders = [{ id: "o1", orderNo: "ORD-0001", customer: "Acme", cableId: "c1", qtyM: 5000, dueDate: "2026-12-31", priority: "normal", status: "pending", createdAt: "2026-06-01" }];

  test("produces a job per stage (with one core job per colour)", () => {
    const { schedule } = runAutoSchedule(orders, cablesById, machines, [], { startDate: new Date("2026-06-15"), mode: "forward" });
    const stages = schedule.map((j) => j.stage);
    expect(stages.filter((s) => s === "core").length).toBe(3); // 3 colours
    expect(stages.filter((s) => s === "bunching").length).toBe(1);
    expect(stages.filter((s) => s === "laying").length).toBe(1);
    expect(stages.filter((s) => s === "sheathing").length).toBe(1);
  });

  test("stages are time-ordered: bunching ends before sheathing starts", () => {
    const { schedule } = runAutoSchedule(orders, cablesById, machines, [], { startDate: new Date("2026-06-15"), mode: "forward" });
    const bunchEnd = Math.max(...schedule.filter((j) => j.stage === "bunching").map((j) => new Date(j.endTime).getTime()));
    const sheathStart = Math.min(...schedule.filter((j) => j.stage === "sheathing").map((j) => new Date(j.startTime).getTime()));
    expect(sheathStart).toBeGreaterThanOrEqual(bunchEnd);
  });
});

describe("risk scoring", () => {
  test("overdue open order scores critical", () => {
    const past = new Date(); past.setDate(past.getDate() - 3);
    const s = orderRiskScore({ status: "pending", dueDate: past.toISOString() }, []);
    expect(s).toBeGreaterThanOrEqual(100);
    expect(riskLevel(s)).toBe("critical");
  });
  test("completed order is not at risk", () => {
    expect(orderRiskScore({ status: "completed", dueDate: "2026-01-01" }, [])).toBe(-1);
  });
});

describe("business hours", () => {
  test("adding hours never lands on a Sunday for a 6-day week", () => {
    const m = defaultMachines()[0];
    const end = addBusinessHours(new Date("2026-06-15T09:00:00"), 40, m);
    expect(end.getDay()).not.toBe(0);
  });
});

describe("core colours", () => {
  test("falls back to defaults when not specified", () => {
    expect(coreColorsFor({ cores: 2 })).toEqual(["Red", "Black"]);
  });
});

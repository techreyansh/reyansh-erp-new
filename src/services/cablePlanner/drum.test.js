// Phase 3 — drum planning engine.
import { splitAcrossDrums, stageDrumCapacity, orderDrumPlan } from "./drum.js";

describe("splitAcrossDrums", () => {
  test("length over capacity → full drums + remainder", () => {
    const r = splitAcrossDrums(2500, 1000);
    expect(r.drumCount).toBe(3);
    expect(r.drums.map((d) => d.lengthM)).toEqual([1000, 1000, 500]);
    expect(r.fits).toBe(false);
  });
  test("length under capacity → one drum, fits", () => {
    const r = splitAcrossDrums(800, 1000);
    expect(r.drumCount).toBe(1);
    expect(r.fits).toBe(true);
  });
  test("exact multiple → no remainder drum", () => {
    const r = splitAcrossDrums(2000, 1000);
    expect(r.drumCount).toBe(2);
    expect(r.drums).toHaveLength(2);
  });
  test("unknown capacity → single drum, fits null", () => {
    const r = splitAcrossDrums(500, 0);
    expect(r.drumCount).toBeNull();
    expect(r.fits).toBeNull();
    expect(r.drums[0].lengthM).toBe(500);
  });
});

describe("stageDrumCapacity", () => {
  const m = { drumCapacityM: 5000, coreCapacityM: 3000, layingDrumCapacityM: 2000 };
  test("core → coreCapacityM", () => expect(stageDrumCapacity("core", m)).toBe(3000));
  test("laying → layingDrumCapacityM", () => expect(stageDrumCapacity("laying", m)).toBe(2000));
  test("bunching/sheathing → drumCapacityM", () => {
    expect(stageDrumCapacity("bunching", m)).toBe(5000);
    expect(stageDrumCapacity("sheathing", m)).toBe(5000);
  });
  test("falls back to drumCapacityM when stage-specific missing", () => {
    expect(stageDrumCapacity("core", { drumCapacityM: 4000 })).toBe(4000);
  });
});

describe("orderDrumPlan", () => {
  const machines = [
    { id: "M1", stage: "bunching", scrapPct: 2, drumCapacityM: 5000 },
    { id: "M2", stage: "core", scrapPct: 3, coreCapacityM: 3000 },
    { id: "M3", stage: "laying", scrapPct: 1, layReductionPct: 2, layingDrumCapacityM: 2000 },
    { id: "M4", stage: "sheathing", scrapPct: 5, drumCapacityM: 1000 },
  ];
  const cable = { id: "C", cores: 3, strandCount: 30, color: "Black" }; // bunching + laying both trigger
  const order = { id: "o1", cableId: "C", qtyM: 2500 };

  test("covers every required stage and picks each stage's drum capacity", () => {
    const plan = orderDrumPlan(cable, order, machines);
    expect(plan.map((p) => p.stage)).toEqual(["bunching", "core", "laying", "sheathing"]);
    expect(plan.find((p) => p.stage === "core").capacityM).toBe(3000);
    expect(plan.find((p) => p.stage === "sheathing").capacityM).toBe(1000);
  });
  test("sheathing finished length (2500m) → 3 drums @1000m capacity", () => {
    const sh = orderDrumPlan(cable, order, machines).find((p) => p.stage === "sheathing");
    expect(sh.totalDrums).toBe(3);
    expect(sh.fits).toBe(false);
  });
  test("core stage winds one set of drums per colour (3 cores)", () => {
    const core = orderDrumPlan(cable, order, machines).find((p) => p.stage === "core");
    expect(core.perCore).toBe(true);
    expect(core.cores).toBe(3);
    expect(core.totalDrums).toBe(core.drumsPerCore * 3);
  });
});

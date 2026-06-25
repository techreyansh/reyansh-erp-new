// R1: single-core cables (no sheath) must not get a phantom sheathing stage,
// and the material estimate must agree with the schedule (no sheath job → no
// sheath PVC; sheath job → sheath PVC).
import { requiredStages, perMeterRM } from "./index.js";

const stages = (c) => requiredStages(c).map((s) => s.stage);

describe("requiredStages — sheathing only when the cable has a sheath", () => {
  test("single-core, no sheath (shThick 0) → no sheathing", () => {
    const s = stages({ cores: 1, size: 1.0, strandCount: 16, shThick: 0 });
    expect(s).toContain("core");
    expect(s).not.toContain("sheathing");
    expect(s).not.toContain("laying");
  });

  test("single-core WITH a sheath (shThick > 0) → sheathing included", () => {
    expect(stages({ cores: 1, size: 1.0, strandCount: 16, shThick: 0.8 })).toContain("sheathing");
  });

  test("two-core still gets sheathing", () => {
    expect(stages({ cores: 2, size: 0.75, strandCount: 24, shThick: 0.8 })).toContain("sheathing");
  });

  test("three-core gets laying + sheathing; bunching when strands ≥ 24", () => {
    const s = stages({ cores: 3, size: 1.0, strandCount: 32, shThick: 0.9 });
    expect(s).toEqual(["bunching", "core", "laying", "sheathing"]);
  });
});

describe("R1 materials — sheath PVC agrees with the schedule", () => {
  test("single-core, explicit no sheath (shThick 0) → zero sheath kg", () => {
    expect(perMeterRM({ cores: 1, size: 1.0, strandCount: 16, shThick: 0 }).sh).toBe(0);
  });

  test("single-core WITH a sheath (shThick > 0) → sheath kg > 0 (matches scheduled sheathing)", () => {
    expect(perMeterRM({ cores: 1, size: 1.0, strandCount: 16, shThick: 0.8 }).sh).toBeGreaterThan(0);
  });

  test("two-core sheathed unchanged → sheath kg > 0", () => {
    expect(perMeterRM({ cores: 2, size: 0.75, strandCount: 24, shThick: 0.8 }).sh).toBeGreaterThan(0);
  });
});

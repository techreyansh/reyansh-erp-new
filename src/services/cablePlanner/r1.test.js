// R1: single-core cables (no sheath) must not get a phantom sheathing stage.
import { requiredStages } from "./index.js";

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

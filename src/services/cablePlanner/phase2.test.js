// Phase 2 — DB machine adapter + capacity board + calendar bucketing.
import { dbMachineToEngine, toEngineMachines } from "./machineAdapter.js";
import { capacityBoard, calendarBuckets } from "./analytics.js";
import { DEFAULT_MACHINES, STAGE_ORDER } from "./machineConfig.js";

// Fixed Wednesday (2026-06-17) so capacity/working-day assertions don't depend
// on the calendar day the suite happens to run (daysPerWeek=6 zeroes Sundays).
const WED = (h, addDays = 0) => new Date(2026, 5, 17 + addDays, h, 0, 0, 0);

describe("dbMachineToEngine", () => {
  test("maps ppc_machines snake_case → engine camelCase, prefers code as id", () => {
    const m = dbMachineToEngine({
      id: "uuid-1", code: "M2", name: "Core Extruder", stage: "core",
      speed_m_per_hr: 700, changeover_min: 45, scrap_pct: 3, lay_reduction_pct: 0,
      shift_start_hour: 9, shift_hours: 8, days_per_week: 6, is_available: true,
    });
    expect(m.id).toBe("M2");
    expect(m.dbId).toBe("uuid-1");
    expect(m.stage).toBe("core");
    expect(m.defaultSpeed).toBe(700);
    expect(m.changeoverMin).toBe(45);
    expect(m.shiftHrs).toBe(8);
    expect(m.isAvailable).toBe(true);
  });
  test("missing numerics fall back to engine defaults", () => {
    const m = dbMachineToEngine({ code: "X", stage: "core" });
    expect(m.shiftStartHour).toBe(9);
    expect(m.shiftHrs).toBe(8);
    expect(m.daysPerWeek).toBe(6);
    expect(m.defaultSpeed).toBe(500);
  });
});

describe("toEngineMachines", () => {
  test("empty DB → full DEFAULT_MACHINES pipeline", () => {
    const ms = toEngineMachines([]);
    expect(ms.map((m) => m.stage)).toEqual(STAGE_ORDER);
    expect(ms).toEqual(DEFAULT_MACHINES);
  });
  test("DB machines override per stage; missing stages fall back", () => {
    const ms = toEngineMachines([
      { code: "B1", stage: "bunching", speed_m_per_hr: 999, is_available: true },
      { code: "C1", stage: "core", is_available: false }, // unavailable → ignored, falls back
    ]);
    const byStage = Object.fromEntries(ms.map((m) => [m.stage, m]));
    expect(byStage.bunching.id).toBe("B1");
    expect(byStage.bunching.defaultSpeed).toBe(999);
    expect(byStage.core).toEqual(DEFAULT_MACHINES.find((d) => d.stage === "core")); // fell back
    expect(ms.map((m) => m.stage)).toEqual(STAGE_ORDER); // always complete
  });
  test("first available machine wins when a stage has several", () => {
    const ms = toEngineMachines([
      { code: "C1", stage: "core", speed_m_per_hr: 700, is_available: true },
      { code: "C2", stage: "core", speed_m_per_hr: 800, is_available: true },
    ]);
    expect(ms.find((m) => m.stage === "core").id).toBe("C1");
  });
});

describe("capacityBoard", () => {
  const machines = [DEFAULT_MACHINES[0]]; // bunching, 8h shift
  test("today's booked vs capacity, util%, and bottleneck flag", () => {
    const schedule = [
      { machineId: "M1", startTime: WED(9).toISOString(), plannedHrs: 5, changeoverHrs: 1 },
      { machineId: "M1", startTime: WED(14).toISOString(), plannedHrs: 3, changeoverHrs: 0.5 },
    ];
    const [b] = capacityBoard(machines, schedule, WED(8));
    expect(b.capacityToday).toBe(8);
    expect(b.bookedToday).toBeCloseTo(9.5, 5);
    expect(b.utilToday).toBe(119);
    expect(b.bottleneck).toBe(true);
    expect(b.jobsTotal).toBe(2);
  });
  test("next changeover = earliest future job with a changeover", () => {
    const schedule = [
      { machineId: "M1", startTime: WED(9).toISOString(), plannedHrs: 2, changeoverHrs: 0 },
      { machineId: "M1", startTime: WED(11).toISOString(), plannedHrs: 2, changeoverHrs: 0.5, coreColor: "Blue" },
    ];
    const [b] = capacityBoard(machines, schedule, WED(8));
    expect(b.nextChangeover).not.toBeNull();
    expect(b.nextChangeover.label).toBe("Blue");
  });
  test("no jobs → zero util, no bottleneck", () => {
    const [b] = capacityBoard(machines, [], WED(8));
    expect(b.utilToday).toBe(0);
    expect(b.bottleneck).toBe(false);
    expect(b.nextChangeover).toBeNull();
  });
});

describe("calendarBuckets", () => {
  const machines = [DEFAULT_MACHINES[0], DEFAULT_MACHINES[1]];
  test("buckets one entry per day and groups jobs by machine on the right day", () => {
    const schedule = [
      { machineId: "M1", stage: "bunching", startTime: WED(9, 0).toISOString(), plannedHrs: 2, changeoverHrs: 0 },
      { machineId: "M2", stage: "core", startTime: WED(10, 1).toISOString(), plannedHrs: 3, changeoverHrs: 0.5 },
    ];
    const days = calendarBuckets(schedule, machines, WED(0, 0), 7);
    expect(days).toHaveLength(7);
    expect(days[0].jobCount).toBe(1);
    expect(days[0].byMachine.M1).toHaveLength(1);
    expect(days[1].jobCount).toBe(1);
    expect(days[1].byMachine.M2).toHaveLength(1);
    expect(days[1].totalHrs).toBeCloseTo(3.5, 5);
  });
});

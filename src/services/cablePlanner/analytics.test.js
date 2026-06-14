import { orderRiskScore, riskLevel, orderRiskWatchlist, machineLoadForecast, loadHeatmap, rmBurndown } from "./analytics.js";
import { DEFAULT_MACHINES } from "./machineConfig.js";
import { estimateRM } from "./materials.js";

const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

describe("orderRiskScore", () => {
  test("completed order → -1", () => {
    expect(orderRiskScore({ status: "completed", dueDate: daysFromNow(-2) }, [])).toBe(-1);
  });
  test("overdue, unplanned → critical (>=100)", () => {
    const s = orderRiskScore({ id: "o1", status: "pending", dueDate: daysFromNow(-3) }, []);
    expect(s).toBeGreaterThanOrEqual(100);
    expect(riskLevel(s)).toBe("critical");
  });
  test("due tomorrow, unplanned → 95 (critical)", () => {
    const s = orderRiskScore({ id: "o2", status: "pending", dueDate: daysFromNow(1) }, []);
    expect(s).toBe(95);
    expect(riskLevel(s)).toBe("critical");
  });
  test("far-future order → low score (ok)", () => {
    const s = orderRiskScore({ id: "o3", status: "pending", dueDate: daysFromNow(40) }, []);
    expect(riskLevel(s)).toBe("ok");
  });
  test("no due date → 0", () => {
    expect(orderRiskScore({ id: "o4", status: "pending" }, [])).toBe(0);
  });
});

describe("orderRiskWatchlist", () => {
  test("returns only at-risk orders, highest score first", () => {
    const orders = [
      { id: "a", status: "pending", dueDate: daysFromNow(-5) }, // overdue → highest
      { id: "b", status: "pending", dueDate: daysFromNow(1) },  // 95
      { id: "c", status: "pending", dueDate: daysFromNow(60) }, // ok → excluded
      { id: "d", status: "completed", dueDate: daysFromNow(-1) }, // excluded
    ];
    const wl = orderRiskWatchlist(orders, []);
    expect(wl.map((r) => r.order.id)).toEqual(["a", "b"]);
    expect(wl[0].score).toBeGreaterThan(wl[1].score);
  });
});

describe("machineLoadForecast", () => {
  const m = DEFAULT_MACHINES[0]; // M1, 8h shift, 6-day week
  const monday = new Date("2026-06-15T00:00:00"); // a Monday (working day)
  test("sums planned + changeover hours on the right day, as % of capacity", () => {
    const job = new Date(monday); job.setHours(10, 0, 0, 0);
    const schedule = [
      { machineId: "M1", startTime: job.toISOString(), plannedHrs: 3, changeoverHrs: 1 },
      { machineId: "M1", startTime: job.toISOString(), plannedHrs: 2, changeoverHrs: 0 },
      { machineId: "M2", startTime: job.toISOString(), plannedHrs: 5, changeoverHrs: 0 }, // other machine
    ];
    const f = machineLoadForecast("M1", schedule, m, 7, monday);
    expect(f).toHaveLength(7);
    expect(f[0].hrs).toBeCloseTo(6, 5);          // 3+1+2
    expect(f[0].capacity).toBe(8);
    expect(f[0].pct).toBe(75);                     // 6/8
  });
  test("non-working day (Sunday) has zero capacity", () => {
    const f = machineLoadForecast("M1", [], m, 14, monday);
    const sundays = f.filter((d) => new Date(d.date + "T00:00:00").getDay() === 0);
    expect(sundays.length).toBeGreaterThan(0);
    for (const s of sundays) expect(s.capacity).toBe(0);
  });
});

describe("loadHeatmap", () => {
  test("returns one row per machine", () => {
    const hm = loadHeatmap(DEFAULT_MACHINES, [], 14);
    expect(hm).toHaveLength(DEFAULT_MACHINES.length);
    expect(hm[0].days).toHaveLength(14);
  });
});

describe("rmBurndown", () => {
  const cable = { id: "c1", code: "R3C25", cores: 3, size: 2.5, strandCount: 50, insThick: 0.8, shThick: 1.0 };
  const cablesById = { c1: cable };
  const base = new Date("2026-06-15T00:00:00");
  const day = (n) => { const d = new Date(base); d.setDate(base.getDate() + n); d.setHours(10); return d.toISOString(); };
  // One order: core starts day0, sheathing day2.
  const schedule = [
    { orderId: "o1", cableId: "c1", stage: "core", startTime: day(0), orderM: 5000 },
    { orderId: "o1", cableId: "c1", stage: "sheathing", startTime: day(2), orderM: 5000 },
  ];
  const rm = estimateRM(cable, 5000);

  test("balance drops by copper+ins on the core day, by sheath on the sheathing day", () => {
    const stock = { copperKg: rm.copper + 10, pvcInsKg: rm.ins + 10, pvcShKg: rm.sh + 10 };
    const { series } = rmBurndown(schedule, cablesById, stock, 5, base);
    expect(series).toHaveLength(5);
    // day0: copper & ins consumed; sheath untouched
    expect(series[0].copper).toBeCloseTo(10, 0);
    expect(series[0].ins).toBeCloseTo(10, 0);
    expect(series[0].sh).toBeCloseTo(rm.sh + 10, 0);
    // day2: sheath consumed
    expect(series[2].sh).toBeCloseTo(10, 0);
  });

  test("flags a shortage day + reorder day when stock is insufficient", () => {
    const stock = { copperKg: 0, pvcInsKg: 0, pvcShKg: 0 };
    const { shortageDay, reorderDay } = rmBurndown(schedule, cablesById, stock, 5, base);
    expect(shortageDay).toBe(0);          // copper goes negative immediately
    expect(reorderDay).toBe(0);            // max(0, 0-2)
  });
});

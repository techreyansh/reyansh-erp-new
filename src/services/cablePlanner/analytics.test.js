import { orderRiskScore, riskLevel, orderRiskWatchlist, machineLoadForecast, loadHeatmap } from "./analytics.js";
import { DEFAULT_MACHINES } from "./machineConfig.js";

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

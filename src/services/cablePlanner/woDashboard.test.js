// Phase 4 — work-order dashboard analytics.
import { woStatusBucket, woProgress, workOrderDashboard } from "./woDashboard.js";

const WED = (addDays = 0) => new Date(2026, 5, 17 + addDays);

describe("woStatusBucket", () => {
  test("maps assorted status strings to stable buckets", () => {
    expect(woStatusBucket("DONE")).toBe("completed");
    expect(woStatusBucket("in_progress")).toBe("running");
    expect(woStatusBucket("released")).toBe("planned");
    expect(woStatusBucket("cancelled")).toBe("cancelled");
    expect(woStatusBucket("open")).toBe("open");
    expect(woStatusBucket(undefined)).toBe("open");
  });
});

describe("woProgress", () => {
  test("produced/qty clamped 0..1", () => {
    expect(woProgress({ qty: 1000, produced_qty: 250 })).toBe(0.25);
    expect(woProgress({ qty: 1000, produced_qty: 1200 })).toBe(1);
    expect(woProgress({ qty: 0, produced_qty: 5 })).toBe(0);
  });
});

describe("workOrderDashboard", () => {
  const wos = [
    { id: "a", status: "open", qty: 1000, produced_qty: 0, due_date: "2026-06-16" },   // overdue (yesterday)
    { id: "b", status: "in_progress", qty: 1000, produced_qty: 200, due_date: "2026-06-18" }, // due soon, low progress → at risk
    { id: "c", status: "in_progress", qty: 1000, produced_qty: 900, due_date: "2026-06-18" }, // due soon but 90% → not at risk
    { id: "d", status: "done", qty: 1000, produced_qty: 1000, scrap_qty: 50, due_date: "2026-06-10" }, // completed
    { id: "e", status: "cancelled", qty: 500, produced_qty: 0 },
  ];
  const dash = workOrderDashboard(wos, WED(0));

  test("counts by bucket + active/total", () => {
    expect(dash.counts).toEqual({ open: 1, planned: 0, running: 2, completed: 1, cancelled: 1 });
    expect(dash.active).toBe(3);
    expect(dash.total).toBe(5);
  });
  test("overall progress + scrap rate over planned qty", () => {
    expect(dash.plannedQty).toBe(4500);
    expect(dash.producedQty).toBe(2100);
    expect(dash.overallProgress).toBe(47); // 2100/4500
    expect(dash.scrapRate).toBeCloseTo(2.3, 1); // 50 / (2100+50)
  });
  test("overdue list = active past due", () => {
    expect(dash.overdue.map((o) => o.wo.id)).toEqual(["a"]);
    expect(dash.overdue[0].daysOverdue).toBe(1);
  });
  test("at-risk includes overdue + due-soon-low-progress, sorted by risk; excludes 90% one", () => {
    const ids = dash.atRisk.map((r) => r.wo.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
    expect(ids[0]).toBe("a"); // overdue ranks highest
  });
});

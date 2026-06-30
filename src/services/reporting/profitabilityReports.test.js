import { buildMonthlyVariance } from "./profitabilityReports";

const summary = {
  range: { from: "2026-01-01", to: "2026-03-31" },
  by_month: [
    { month: "2026-01", revenue: 100000, gross_profit: 30000, contribution: 25000, gm_pct: 30, net_profit: 12000, net_margin: 12 },
    { month: "2026-02", revenue: 0, gross_profit: 0, contribution: 0, gm_pct: null, net_profit: null, net_margin: null },
  ],
};

test("buildMonthlyVariance includes Net Profit and Net % columns", () => {
  const report = buildMonthlyVariance(summary);
  const section = report.sections.find((s) => s.key === "by_month");
  const colLabels = section.columns.map((c) => c.label);
  expect(colLabels).toContain("Net Profit");
  expect(colLabels).toContain("Net %");
});

test("buildMonthlyVariance renders a costed month's net and a null month's net as dash", () => {
  const report = buildMonthlyVariance(summary);
  const rows = report.sections.find((s) => s.key === "by_month").rows;
  expect(rows[0].net_profit).toBe("₹12,000");
  expect(rows[1].net_profit).toBe("—");
  expect(rows[1].net_margin).toBe("—");
});

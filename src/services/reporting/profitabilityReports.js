// Named profitability report builders → Report objects for ReportExportButton
// (PDF/Excel/CSV/Print). CEO-only data, already fetched by the page.
const inr = (v) => "₹" + Math.round(Number(v || 0)).toLocaleString("en-IN");
const signed = (v) => (Number(v || 0) >= 0 ? "+" : "") + inr(v);
const pct = (v) => (v == null ? "—" : Number(v).toFixed(1) + "%");
const rangeLine = (r) => (r ? `${r.from} → ${r.to}` : "");

// CEO Variance Summary — expected vs actual GP, top movers, material factors.
export function buildVarianceSummary(actual, range) {
  const k = actual?.kpis || {};
  const byp = actual?.by_product || [];
  const neg = byp.filter((p) => p.has_actual).slice().sort((a, b) => a.gp_var - b.gp_var).slice(0, 10);
  const pos = byp.filter((p) => p.has_actual).slice().sort((a, b) => b.gp_var - a.gp_var).slice(0, 10);
  return {
    title: "CEO Variance Summary — Expected vs Actual",
    subtitle: `Reyansh International · ${rangeLine(range || actual?.range)}`,
    sections: [
      { key: "kpis", title: "Headline", columns: [{ key: "m", label: "Metric" }, { key: "v", label: "Value", align: "right" }],
        rows: [
          { m: "Expected GP", v: inr(k.exp_gp) }, { m: "Actual GP", v: inr(k.act_gp) },
          { m: "GP variance", v: signed(k.gp_var) }, { m: "Material variance", v: signed(k.mat_var) },
          { m: "Revenue variance", v: signed(k.rev_var) },
          { m: "Products with actuals", v: `${k.products_with_actual || 0} / ${k.products_total || 0}` },
        ] },
      { key: "factors", title: "Why margin moved — material factors",
        columns: [{ key: "group", label: "Material" }, { key: "expected", label: "Expected", align: "right" }, { key: "actual", label: "Actual", align: "right" }, { key: "variance", label: "Variance", align: "right" }],
        rows: (actual?.material_factors || []).map((f) => ({ group: f.group, expected: inr(f.expected), actual: inr(f.actual), variance: signed(f.variance) })) },
      { key: "neg", title: "Biggest negative variances (margin lost)",
        columns: [{ key: "code", label: "Product" }, { key: "exp", label: "Exp GP", align: "right" }, { key: "act", label: "Act GP", align: "right" }, { key: "var", label: "Variance", align: "right" }],
        rows: neg.map((p) => ({ code: p.name || p.code, exp: inr(p.exp_gp), act: inr(p.act_gp), var: signed(p.gp_var) })) },
      { key: "pos", title: "Biggest positive variances (margin gained)",
        columns: [{ key: "code", label: "Product" }, { key: "exp", label: "Exp GP", align: "right" }, { key: "act", label: "Act GP", align: "right" }, { key: "var", label: "Variance", align: "right" }],
        rows: pos.map((p) => ({ code: p.name || p.code, exp: inr(p.exp_gp), act: inr(p.act_gp), var: signed(p.gp_var) })) },
      { key: "needs", title: "Sold but not yet produced (no actual)",
        columns: [{ key: "code", label: "Product" }, { key: "rev", label: "Expected revenue", align: "right" }],
        rows: (actual?.needs_actual || []).map((p) => ({ code: p.name || p.code, rev: inr(p.exp_rev) })) },
    ],
  };
}

// Monthly Variance — GP & CM by month (from profit_summary).
export function buildMonthlyVariance(summary) {
  const rows = (summary?.by_month || []).map((m) => ({
    month: m.month, revenue: inr(m.revenue), gross_profit: inr(m.gross_profit),
    contribution: m.contribution != null ? inr(m.contribution) : "—", gm: pct(m.gm_pct),
    net_profit: m.net_profit != null ? inr(m.net_profit) : "—",
    net_margin: pct(m.net_margin),
  }));
  return {
    title: "Monthly Profit — Revenue / GP / Contribution",
    subtitle: `Reyansh International · ${rangeLine(summary?.range)}`,
    sections: [
      { key: "by_month", title: "By month",
        columns: [{ key: "month", label: "Month" }, { key: "revenue", label: "Revenue", align: "right" }, { key: "gross_profit", label: "Gross Profit", align: "right" }, { key: "contribution", label: "Contribution", align: "right" }, { key: "gm", label: "GM %", align: "right" }, { key: "net_profit", label: "Net Profit", align: "right" }, { key: "net_margin", label: "Net %", align: "right" }],
        rows },
    ],
  };
}

const profitabilityReports = { buildVarianceSummary, buildMonthlyVariance };
export default profitabilityReports;

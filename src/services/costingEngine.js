// Pure costing math (no network) — recompute a costing summary from its lines.
// Used by the costing editor's live margin calculator and by save. Tested.

export const COST_SECTIONS = ['material', 'labour', 'machine', 'overhead', 'financial'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** amount for a line: explicit amount, else qty*rate; percentage lines resolved later. */
export function lineAmount(line) {
  if (!line) return 0;
  if (line.is_percentage) return 0; // resolved against a base in recompute
  if (line.amount != null && line.amount !== '') return num(line.amount);
  return num(line.qty) * num(line.rate);
}

/**
 * Recompute section totals + selling price + margins.
 * @param lines [{section, amount|qty,rate, is_percentage, pct_basis}]
 * @param opts  { targetMarginPct, qtyBasis }
 * Margin convention: margin is on SELLING price → price = cost / (1 - m/100).
 */
export function recompute(lines = [], opts = {}) {
  const targetMarginPct = num(opts.targetMarginPct);
  const sums = { material: 0, labour: 0, machine: 0, overhead: 0, financial: 0 };

  // 1) absolute lines
  for (const l of lines) {
    if (!l || !sums.hasOwnProperty(l.section)) continue;
    if (!l.is_percentage) sums[l.section] += lineAmount(l);
  }
  // 2) percentage lines (e.g. overhead = 8% of material) — applied after absolutes
  for (const l of lines) {
    if (!l || !sums.hasOwnProperty(l.section) || !l.is_percentage) continue;
    const base = l.pct_basis === 'total'
      ? COST_SECTIONS.reduce((a, s) => a + sums[s], 0)
      : (sums[l.pct_basis] != null ? sums[l.pct_basis] : sums.material);
    sums[l.section] += base * num(l.amount ?? l.rate) / 100;
  }

  const material_cost = +sums.material.toFixed(2);
  const labour_cost = +sums.labour.toFixed(2);
  const machine_cost = +sums.machine.toFixed(2);
  const overhead_cost = +sums.overhead.toFixed(2);
  const financial_cost = +sums.financial.toFixed(2);
  const total_cost = +(material_cost + labour_cost + machine_cost + overhead_cost + financial_cost).toFixed(2);

  const m = Math.min(Math.max(targetMarginPct, 0), 99.99);
  const net_selling_price = +(m > 0 ? total_cost / (1 - m / 100) : total_cost).toFixed(2);
  const price = net_selling_price || total_cost;
  const pct = (cost) => (price > 0 ? +(((price - cost) / price) * 100).toFixed(2) : 0);

  return {
    material_cost, labour_cost, machine_cost, overhead_cost, financial_cost, total_cost,
    target_margin_pct: targetMarginPct,
    net_selling_price,
    contribution_pct: pct(material_cost + labour_cost),                 // price − variable
    gross_margin_pct: pct(material_cost + labour_cost + machine_cost),  // price − COGS
    net_margin_pct: pct(total_cost),                                    // price − all cost
    qty_basis: num(opts.qtyBasis) || 1,
  };
}

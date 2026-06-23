// Dynamic recosting engine (pure). Re-prices a costing's lines from the live
// Rate Master and recomputes cost/price/margin via the shared costingEngine —
// so changing a master rate flows through to product cost. No network.
import { recompute } from './costingEngine';

const num = (v) => Number(v) || 0;

/**
 * Re-price each line from rateMap (code -> rate), EXCEPT:
 *  - rate_overridden lines (manually frozen) are left untouched,
 *  - percentage lines are handled separately (their % can also be mastered).
 * @param lines   [{ material_code, qty, rate, rate_overridden, is_percentage, ... }]
 * @param rateMap { COPPER: 745, PVC_INS: 110, OVERHEAD_PCT: 8, ... }
 */
export function repriceLines(lines = [], rateMap = {}) {
  return lines.map((l) => {
    const code = l.material_code;
    // percentage lines (overhead/finance/margin): refresh the % from the master if mapped
    if (l.is_percentage) {
      if (!l.rate_overridden && code && rateMap[code] != null) return { ...l, rate: num(rateMap[code]) };
      return { ...l };
    }
    if (l.rate_overridden) return { ...l }; // frozen by user
    if (code && rateMap[code] != null) {
      const rate = num(rateMap[code]);
      return { ...l, rate, amount: +(num(l.qty) * rate).toFixed(2) };
    }
    return { ...l };
  });
}

/** Recompute a costing at a given rate map + target margin. Returns engine summary + the priced lines. */
export function costAt(lines = [], rateMap = {}, marginPct = 0) {
  const priced = repriceLines(lines, rateMap);
  const summary = recompute(priced, { targetMarginPct: num(marginPct) });
  return { ...summary, lines: priced };
}

/**
 * What-if / cost-impact: current rates vs a set of new/overridden rates.
 * Does NOT save. Returns { current, new, delta }.
 */
export function costImpact(lines = [], currentRates = {}, overrides = {}, marginPct = 0, newMargin = null) {
  const current = costAt(lines, currentRates, marginPct);
  const merged = { ...currentRates, ...overrides };
  const next = costAt(lines, merged, newMargin != null ? newMargin : marginPct);
  const d = (a, b) => +(b - a).toFixed(2);
  return {
    current, new: next,
    delta: {
      material_cost: d(current.material_cost, next.material_cost),
      total_cost: d(current.total_cost, next.total_cost),
      net_selling_price: d(current.net_selling_price, next.net_selling_price),
      net_margin_pct: d(current.net_margin_pct, next.net_margin_pct),
      total_cost_pct: current.total_cost ? +(((next.total_cost - current.total_cost) / current.total_cost) * 100).toFixed(2) : 0,
    },
  };
}

/** Is a saved version stale vs current rates? (its stored total_cost differs from a fresh recompute) */
export function isStale(version, lines, rateMap, tol = 0.01) {
  const fresh = costAt(lines, rateMap, num(version.target_margin_pct));
  return Math.abs(fresh.total_cost - num(version.total_cost)) > tol;
}

const recostEngine = { repriceLines, costAt, costImpact, isStale };
export default recostEngine;

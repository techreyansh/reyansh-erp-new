# Profitability V2 — Net Profit Allocation

**Date:** 2026-06-30
**Module:** Profitability Intelligence Center (CEO-only, Accounts & Finance)
**Status:** Design approved, ready for implementation plan

## Problem

The Profitability Center computes Net Profit only at the **company level**. The
`profit_summary` RPC returns a `net` block (`Σcontribution − Σfixed_conv −
Σoperating_expenses`), but the per-line rollups (`by_product`, `by_customer`,
`by_order`, `by_month`) stop at gross profit / contribution. The CEO can see the
company is net-positive, but not **which products or customers actually make
money after running costs are loaded on**. A high-gross-margin SKU can be a net
loser once its share of admin/selling/factory overhead is counted, and today
that's invisible.

## Goal

Push company operating expenses (`expense_entry`) down onto each product,
customer, order, and month so every rollup carries an allocated **Net Profit**
line, not just gross profit / contribution.

## Approach

**Extend `profit_summary` in place.** Add `allocated_opex` + `net_profit` +
`net_margin` fields to each existing rollup, computed as a revenue-share of the
operating-expense total the RPC already calculates for the company `net` block.

Rejected alternatives:
- **Separate RPC** (`profit_net_allocation`): re-derives the same fact set and
  revenue totals, duplication that drifts out of sync.
- **Persisted allocation snapshots**: pro-rata-by-revenue is deterministic and
  cheap to recompute; a snapshot table buys only staleness risk.

**No schema change.** Allocation is pure computation. `contribution` and
`fixed_conv` are already per-line; revenue-share needs nothing stored. One
migration that only redefines the `profit_summary` function — no new tables, no
data migration, additive and reversible.

## The math

Per costed line:

```
allocated_opex = revenue / total_costed_revenue × total_opex
net_profit     = contribution − fixed_conv − allocated_opex
net_margin     = net_profit / revenue × 100
```

Where:
- `total_opex` = `v_exp`, the **full-company** period operating-expense total
  summed from `expense_entry`. `expense_entry` has no product/customer link, so
  this total is inherently company-wide and **does not** narrow with `p_filters`.
- `total_costed_revenue` = `Σ revenue WHERE NOT uncosted` over the **full-company
  unfiltered** fact set for the period — computed independently of `p_filters`,
  symmetric with `total_opex`.

Both totals are full-company and filter-invariant **by design**: a product's true
overhead burden is its share of the *whole* company, not its share of whatever
subset the user is currently filtering to. This makes each line's `allocated_opex`
stable no matter how the view is filtered (see edge case 4).

Allocation basis: **pro-rata by revenue** (a line with 10% of revenue carries
10% of operating expenses). One rule for all expense types — simplest and most
defensible; expense-type-specific bases were considered and deferred (see
Non-goals).

## Edge cases

1. **Uncosted lines absorb no overhead.** Lines flagged `uncosted` have no
   reliable cost picture. Loading overhead onto them would invent a fake loss.
   They are excluded from `total_costed_revenue` (the denominator) and get
   `allocated_opex = 0`, `net_profit = null`. They continue to show
   GP/contribution exactly as today.
2. **Zero-revenue period guard.** If `total_costed_revenue = 0`, every
   `allocated_opex = 0` (no division by zero). Operating expenses remain visible
   only in the company `net` block.
3. **Reconciliation invariant (unfiltered view).** In the unfiltered view,
   `Σ allocated_opex (over costed lines) = total_opex`, therefore
   `Σ per-line net_profit = company net_profit`. Same rollup-reconciliation
   discipline validated for the V1 GP rollups (company GP = Σcustomer = Σproduct
   = Σorder = Σmonth).
4. **Filtered views are a subset, not a re-base.** `total_opex` and
   `total_costed_revenue` are always the **full-company** totals (edge of the
   math section), so a line's `allocated_opex` is identical whether or not a
   filter is active. When `p_filters` is set you see a *subset* of lines, each
   carrying its true company-wide overhead share; their net profits sum to a
   subset of company net, not the whole — which is the correct reading of a
   filtered view. We deliberately do NOT re-base the denominator to the filtered
   set, because that would make every product appear to absorb ~100% of company
   overhead the moment you filter to it.

## Components

### Backend — `profit_summary` RPC (one migration)
- New migration `supabase/migrations/<ts>_profitability_net_allocation.sql`
  redefining `profit_summary(p_from, p_to, p_basis, p_filters)`.
- Compute `total_costed_revenue` once (alongside the existing `v_exp`).
- In each rollup select (`by_product`, `by_customer`, `by_order`, `by_month`),
  add `allocated_opex`, `net_profit`, `net_margin` using the formula above,
  guarding the zero-revenue case.
- `SECURITY DEFINER` + `is_super_admin()` guard preserved (unchanged).

### Frontend — `ProfitabilityCenter.js`
- Each affected tab's table (Products, Customers, Orders, and the monthly
  trend) gains a **Net Profit** column and a **Net %** column.
- A per-row ladder (tooltip or expandable cell) shows
  `Contribution → − Fixed conv → − Allocated overhead → Net profit` so the CEO
  sees why a line's net differs from its margin.
- Visual treatment matches the existing traffic-light / KPI styling (MUI `sx`,
  no new component system).

### Reports — `profitabilityReports.js`
- `buildMonthlyVariance` and the per-table exports read the rollup objects
  directly, so they pick up `net_profit` / `net_margin` automatically. Add the
  Net columns to the relevant report section column lists.

## Non-goals (deferred)

- **Expense-type-specific allocation bases** (selling by revenue, factory by
  volume, etc.). Revenue pro-rata first; revisit if the CEO wants finer
  attribution.
- **Direct expense → product/customer tagging.** Would need a schema column and
  tagging UI. Out of scope for this lake.
- **Budget vs actual on net.** Separate roadmap item.

## Testing

- **RPC unit check (live REST, CEO token):** for a known period, verify
  `Σ per-line net_profit = company net_profit` across each dimension, and that an
  uncosted line shows `net_profit = null` with `allocated_opex = 0`.
- **Zero-revenue guard:** call with a period that has expenses but no costed
  sales; confirm no error and `allocated_opex = 0` everywhere.
- **Frontend:** existing 38-suite jest run stays green; new columns render
  without crashing when `net_profit` is null (shows "—").
- **Reconciliation:** hand-verify one product and one customer against a manual
  `revenue_share × total_opex` calculation.

## Rollout

Additive and reversible: the migration only redefines a function; the previous
definition can be restored. Ships via the standard branch → `/ship` → PR →
`/land-and-deploy` (Vercel) flow. Follows the migration-ledger safety recipe
(timestamp after the latest applied migration; never blind `db push
--include-all`).

# Daily Auto-Planner — Spec (Power Cord MES, Phase 4)

**Date:** 2026-06-25 · **Branch:** design-system-rollout · **Module gate:** `production`

## Goal
A one-click **Auto-plan** on the existing `/daily-plan` screen that takes open production
demand and lays it out across upcoming working days — due-date driven, capped each day by
the **shared molding pool** — produces **draft** `daily_production_plan` rows for review,
flags any demand that finishes after its due date, then **commits atomically** and feeds the
existing "Release to floor" flow.

## Decisions (locked with user)
1. **Due-date driven** allocation (earliest `required_date` first, then priority).
2. **Shared molding machines** are the binding constraint (not per-product lines).
3. **Pool sized from `molding_master`** — every active mold contributes capacity.
4. **One molding pass per unit** (v1 simplification; multi-pass inner/outer/grommet = future).
5. **Atomic commit via RPC** `mes_auto_commit_plan` (not a row-by-row loop).

## Capacity model
- Mold capacity (pcs/hr) for an active mold = `cavity_count × (3600 / cycle_time_sec)`.
- **Daily molding pool (pcs/day)** = Σ active molds' pcs/hr × **shift hours** (from `shift_master`,
  primary active shift; editable at top of the dialog).
- Each demand unit consumes **1 pass** from the day's pool.

## Algorithm (pure function `autoPlan`)
Inputs: `demands[]` (qty, planned_qty, required_date, priority, product), `poolPerDay`,
`workingDays[]` (dates, start = today, Sundays skippable), .
1. `remaining = qty − planned_qty`; drop demands with `remaining <= 0`.
2. Sort by `required_date ASC`, then priority rank.
3. For each demand, fill the earliest day with pool left, consuming it; **split across
   consecutive days** when remaining > that day's free pool (one plan row per day-chunk).
4. If a demand's last chunk lands on a date **>= after** its `required_date` → mark `late: true`.
5. Return `{ rows[], perDay[{date, used, capacity}], lateCount }`. **No DB writes.**

Pure + deterministic → unit-tested in `src/services/autoPlanner.test.js`.

## Preview → Commit
- Dialog shows the proposed rows grouped by date, per-day **used/capacity** bar, LATE chips.
- Planner may remove rows / edit qty before committing.
- **Commit** → `mes_auto_commit_plan(p_rows jsonb)`:
  - bulk-insert `daily_production_plan` (status `planned`, notes `auto: SO-xxx`),
  - bump `production_demand.planned_qty += allocated`, flip status `pending→planned`
    (or `planned` when fully covered), in **one transaction**.
- Existing per-row **Release to floor** (`mes_release_plan_to_floor`) unchanged.

## Files
- `supabase/migrations/20260625140000_mes_auto_commit_plan.sql` — the commit RPC (SECURITY DEFINER, race-safe).
- `src/services/autoPlanner.js` — `moldingPoolPerHour(molds)`, `buildWorkingDays(...)`, `autoPlan(...)` (pure), `commitAutoPlan(rows)` (RPC call).
- `src/services/autoPlanner.test.js` — unit tests for the pure allocation.
- `src/pages/mes/DailyPlan.js` — add "⚡ Auto-plan" button + `<AutoPlanDialog/>`.
- `src/pages/mes/AutoPlanDialog.js` — preview + commit UI.

## Reuse
`productionDemandService.listDemand`, `mesMasterService.listRows` (molding_master, shift_master,
department), `mesCapacityService.moldingCapacityPerHour`, `mes_release_plan_to_floor`.

## Out of scope (v1)
Separate inner/outer/grommet pools; assembly/packing capacity limits; drag-drop Gantt.

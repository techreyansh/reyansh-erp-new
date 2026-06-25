# MES Routing-Driven Redesign — Plan

**Date:** 2026-06-25 · **Branch:** design-system-rollout · **Module gate:** `production`
**Thesis:** Cycle time is **not** a property of an operation. It is a property of a
**(part × operation × mold/tooling × customer spec)**. Move every planning, scheduling,
operator/machine, bottleneck, and OEE calculation off the generic Process Master and onto
the **Part Operation Master (Routing)**.

---

## 0. Current state (from audit) — what we keep, fix, add

**The good news:** the spine already exists.
- `product_process_step` is **already per-product** and already carries `standard_time_sec`,
  `manpower`, `machine`, `operation_id` — but **no capacity engine reads it**. They all read
  the generic `assembly_operation.std_time_sec`. That is the core defect.
- `molding_master` already stores `cavity_count`, `cycle_time_sec`, `machine_compat`,
  `tool_life_shots`, `shots_done`, `product_id`, `mold_type`.
- `product_revision` + `costing_version` give a versioning pattern to copy.

**The defects to fix:**
1. Capacity/line-balancing read **generic** `assembly_operation.std_time_sec` (CapacityPlanner.js,
   LineBalancing.js). Wrong for molding and for any customer-varying op.
2. Routing (`product_process_step`) has **no** cavities, mold binding, scrap%, output/cycle,
   setup/changeover, parallel machines, min/max operators, OEE.
3. No **OEE** anywhere; `stage_execution_log` has actuals but no `expected_output_qty` to compare against.
4. No **routing versioning / ECN** — routing edits are silent and unhistoried.
5. Two WO creators (`ppc_create_work_order` route-configured vs `cable_create_work_order`
   payload-driven). **Cable production must not break** — power-cord-first, additive, fallback-preserving.

---

## 1. Level 1 — Process Master (`assembly_operation`): generic only

Keep it as the **operation dictionary**. It defines *what an operation is*, never *how fast a
specific part runs*.

**Add columns (additive):**
| Column | Purpose |
|---|---|
| `machine_type text` | e.g. injection_molding, crimping, cutting, manual |
| `constraint_type text CHECK (machine,labour)` | is this op machine- or labour-constrained |
| `parallel_allowed boolean` | can multiple machines/stations run this op in parallel |
| `default_oee numeric` | fallback OEE when routing doesn't override |
| `default_setup_sec numeric`, `default_changeover_sec numeric` | fallback setup/changeover |
| `skills_required text` | standard skill/grade |

**Demote (do not drop):** `std_time_sec` and `uph` become **fallback-only** (`default_cycle_sec`).
Used solely when a routing op has no part-specific cycle. We keep the column to avoid breaking
existing reads; the engines stop trusting it as truth.

---

## 2. Level 2 — Part Operation Master / Routing (`product_process_step`): the source of truth

Every finished good / semi-finished part has its own routing; each op stores its real standard.

**Add columns (additive):**
| Column | Purpose |
|---|---|
| `mold_id uuid → molding_master` | which mold runs this molding step (drives cavities + cycle) |
| `cycle_time_sec numeric` | the real per-part cycle (rename intent of `standard_time_sec`; keep old col, copy) |
| `cavities int` | override; if `mold_id` set, defaults from the mold |
| `output_per_cycle numeric` | pieces produced per machine cycle (default = cavities) |
| `scrap_pct numeric` | per-step scrap → inflates required input |
| `setup_time_sec`, `changeover_time_sec numeric` | overrides of the Process Master defaults |
| `parallel_machines int` | machines allowed in parallel for this step |
| `min_operators`, `max_operators int` | operator band for labour balancing |
| `oee numeric` | per-step OEE override (else Process Master default) |
| `quality_check_required boolean` | per-step QC gate (works with existing quality trigger) |
| `routing_version_id uuid → routing_version` | which version this row belongs to |

**Rule the whole system obeys:** *planning/scheduling/OEE read routing first; fall back to mold,
then to Process Master defaults — never the reverse.*

---

## 3. Mold Master (`molding_master`): referenced, not retyped

Already close. **Add:** `part_number text`, `pm_interval_shots numeric`, `last_pm_date date`,
`next_pm_due_shots numeric` (preventive maintenance). Routing binds via `product_process_step.mold_id`,
so cavities/cycle live on the mold and are inherited (overridable per routing step).

**Molding UPH (the canonical formula):**
```
UPH_per_machine = (3600 / cycle_time_sec) × cavities × OEE
```
Part A: 24s, 2 cav → 300 (×OEE). Part B: 18s, 6 cav → 1200 (×OEE). Same op, different parts. Correct.

---

## 4. Routing versioning + ECN

New tables (copying the `costing_version` pattern):
- **`routing_version`**: `product_id`, `version_number int` (auto-increment per product),
  `status CHECK (draft,active,superseded)`, `effective_from`, `effective_to`, `ecn_id`,
  `approved_by_email`, `approved_at`, `notes`. **Exactly one `active` per product.**
- **`engineering_change_note` (ECN)**: `ecn_number` (race-safe mint), `reason`, `status
  CHECK (open,approved,implemented,cancelled)`, `raised_by`, `approved_by`, `affected_product_ids jsonb`.
- `product_process_step.routing_version_id` ties each routing row to a version.

**Planning always reads the `active` routing_version.** Editing creates a new `draft` version
(snapshot-copy of active rows); approving an ECN flips draft→active, active→superseded with
`effective_to`. Full history, reproducible plans, customer-specific routings as separate versions.

---

## 5. Capacity engine — rewrite to be routing-driven (pure, tested)

New pure module **`src/services/routingCapacity.js`** (no Supabase import → unit-testable like
`autoPlanner.js`). One function computes a single routing op's standard; one rolls up a routing.

Per op:
```
effOEE      = op.oee ?? processDefault.oee ?? 1
cycle       = op.cycle_time_sec ?? mold.cycle_time_sec ?? processDefault.default_cycle_sec
cavities    = op.cavities ?? mold.cavity_count ?? 1
opPerCycle  = op.output_per_cycle ?? cavities
if machine-constrained:
  uphPerMachine = (3600 / cycle) × opPerCycle × effOEE
  reqMachines   = ceil(targetUPH / uphPerMachine)   (capped by parallel_machines / compatible machines)
  capacity      = availMachines × uphPerMachine
else (labour):
  uphPerOperator = (3600 / cycle) × effOEE
  reqOperators   = clamp(ceil(targetUPH / uphPerOperator), min_operators, max_operators)
  capacity       = reqOperators × uphPerOperator
scrapInflate = 1 / (1 − scrap_pct)        // required INPUT to yield target good output
```
Rollup: **bottleneck = min(capacity)** across ops; **line UPH = bottleneck capacity**;
daily capacity = bottleneck UPH × shift hours (minus setup/changeover lost time).
`CapacityPlanner.js` and `LineBalancing.js` are rewired to read the active routing per selected
product (not the generic operation list). Where routing is blank, fall back to defaults + show a
"using defaults" hint so gaps are visible, not silent.

---

## 6. Scheduling / auto-planner — finite shared mold & machine capacity

Replace the **flat molding pool** (the model in the just-built `autoPlanner.js`, now obsolete)
with **routing-derived per-product capacity contending for shared molds + machines**:
- A mold runs one machine at a time → a day's mold-hours are a finite resource per mold.
- Compatible machines per `machine_type` are a finite pool.
- Allocator (keep the due-date greedy + preview + atomic commit scaffolding already built)
  consumes **mold-hours and machine-hours** per allocation, flags the binding constraint
  (mold vs machine vs labour) per day, and surfaces machine/operator loading.

The existing `autoPlanner.js` allocator, `AutoPlanDialog.js` preview, and `mes_auto_commit_plan`
RPC **survive**; only the capacity input changes from `poolPerDay:number` to a per-product,
per-day capacity model from `routingCapacity.js`.

---

## 7. OEE — operation-specific, actual vs routing standard

- Add `expected_output_qty numeric` to `stage_execution_log` (the routing standard for that
  run window) + `runtime_min`.
- New view/RPC **`mes_oee`**: per operation / WO / day,
  `Availability = (runtime − downtime)/runtime`,
  `Performance = actual_output / (routing_standard_rate × runtime)`,
  `Quality = good/(good+reject)`, `OEE = A×P×Q`.
- Compares against the **routing standard for that exact part**, never the generic op.
- Surfaces on MESDashboard (extends existing `mesCapacityService.getDashboard`).

---

## 8. Migration & backfill (additive, power-cord-first, zero downtime)

Ordered migrations (`2026062514xxxx…`):
1. `…_process_master_generic.sql` — add Level-1 generic cols; keep std_time_sec as fallback.
2. `…_routing_params.sql` — add all Level-2 routing cols + `mold_id`.
3. `…_routing_versioning.sql` — `routing_version` + `engineering_change_note` + `routing_version_id`.
4. `…_mold_master_pm.sql` — mold PM/part_number cols.
5. `…_oee.sql` — `stage_execution_log.expected_output_qty`/`runtime_min` + `mes_oee`.

**Backfill (so nothing breaks):** for each product with steps, create a v1 `active`
routing_version; copy `standard_time_sec → cycle_time_sec`; bind molding steps to the matching
`molding_master` row by `product_id + mold_type`; inherit cavities/cycle from the mold; seed
OEE/setup from Process Master defaults. Products without routing keep working via the fallback chain.

---

## 9. Phased rollout (each phase additive + verifiable, gated)

- **P0 Schema + backfill** — columns/tables/RPC, no behavior change. Verify reads still work.
- **P1 Routing editor** — capture per-op params + mold binding + versioning in the NPD/Product
  routing UI (extend existing `RoutingEditor`).
- **P2 Capacity reads routing** — rewire CapacityPlanner + LineBalancing to `routingCapacity.js`,
  fallback-with-hint. Verify Part A vs Part B compute different UPH.
- **P3 Scheduling** — auto-planner consumes routing capacity + shared mold/machine contention.
- **P4 OEE** — expected_output capture + OEE dashboard.
- **P5 ECN workflow** — draft→approve→active routing versions + revision history UI.

---

## 10. Impact on the in-flight Daily Auto-Planner (built this session, unshipped)

Keep: due-date allocator (11 passing tests), `AutoPlanDialog` preview, `mes_auto_commit_plan`.
Replace: the flat `moldingPoolPerHour` capacity input → routing-driven per-product capacity (P3).
**Decision: do not ship the auto-planner standalone;** fold it into P3 of this redesign.

---

## 11. Open decisions for review
1. **Cavities home:** always via `mold_id` (inherit) vs allow a routing override when no mold? (Plan: mold-first, override allowed.)
2. **Scheduling depth:** model shared molds + machines as finite per-day hours now (P3), or start with single binding bottleneck and add machine contention later?
3. **OEE default:** start at 100% (pure standard) and let actuals teach it, or seed per Process-Master default_oee?
4. **Rewrite vs additive:** rewire engines with fallback (recommended) vs hard cutover once backfill is verified.
5. **Cable routing:** bring cable production onto the same routing model (risky `cable_create_work_order` reconciliation) or leave cable on its payload-driven path and apply this only to power cord / harness?

---

## GSTACK REVIEW REPORT (/autoplan — 2026-06-25)

**Voices:** Claude subagent per phase (CEO / Eng / Design). Codex **unavailable** (binary
not installed) → `subagent-only`, single-model. DX phase **skipped** (internal ERP, not a dev tool).

### Cross-phase theme (flagged independently by all 3 phases — highest-confidence signal)
**The plan is ~2x over-scoped for a one-engineer, ~3-active-SKU shop with zero captured
shop-floor data.** CEO: "engineering ahead of adoption — the binding constraint is still
operators posting job cards." Design: "ECN approval is bypassable ceremony; an OEE dashboard
with no data reads as broken." Eng: "the ECN/versioning layer is the riskiest claimed-but-
unspecified part." All three converge on: **ship the schema + the real bug fix; defer the
heavy layers until data exists.**

### CEO (strategy) — verdict: PROCEED REDUCED
- **Premises challenged.** Load-bearing + likely-wrong (all *unstated* in the plan):
  (a) "enough SKUs / shared-mold contention to justify finite scheduling + ECN" — false (3 cables,
  empty product master); (b) "operators will post job cards so OEE has actuals" — currently false
  (`stage_execution_log` empty); (c) "a one-engineer shop needs a draft→approve→active ECN chain" — false.
- The one genuinely non-deferrable fact: **the molding capacity formula is wrong** (ignores cavities).
  That's one bug, not a 6-phase redesign.
- Right-sized: **P0 + P2 + minimal P1 keep. P3 (scheduler) + P4 (OEE) defer until real data. P5 (ECN) cut.**

### Eng (architecture) — verdict: APPROVE ARCHITECTURE, two CRITICAL mechanism gates before P0
- **C1 (critical):** `plmProductService.saveProcess` does `delete().eq('product_id').then(insert)` —
  it **wipes all routing rows on every save**, which destroys the versioning P0 introduces. Must
  rewrite to be version-scoped BEFORE `routing_version_id` lands. Claimed-as-done in prose, absent in code.
- **C2 (critical):** "exactly one active routing_version per product" has **no enforcement** and a
  flip race. Need `CREATE UNIQUE INDEX … ON routing_version(product_id) WHERE status='active'` + a
  single SECURITY DEFINER `mes_activate_routing_version` RPC (mirror the `mes_auto_commit_plan` atomic pattern).
- **H1 (high):** backfill binding molds by `product_id + mold_type` is **not unique** (multi-mold
  products, shared molds whose `product_id` names only one owner) → mis-bind or abort. Make it
  category-aware + emit a coverage report, don't guess.
- **H2 (high):** copying `standard_time_sec → cycle_time_sec` for molding **double-counts cavities**
  (per-piece labour time vs per-machine-cycle time). For molding steps leave `cycle` NULL and inherit
  from the mold. This is a silent-wrong-number on exactly the ops the plan exists to fix.
- **H3 (high):** the two WO creators are **isolated on routing** (cable is payload-driven, provably
  untouched — good) **but share a racy WO-number mint**. Centralize minting + `UNIQUE(ppc_wo.wo_number)`
  before P3 adds auto-planner WO traffic.
- **H4 (high):** OEE `Performance` is underspecified for a multi-op WO + per-operator log rows;
  define OEE at operation/day grain, compute `expected_output_qty` per log row at post time.
- **M1–M4:** divide-by-zero guards (`scrap_pct=1.0`, `cycle=0`, `parallel=0`, `min>max`) must be in
  `routingCapacity.js` and unit-tested; mold `status`/tool-life must zero out capacity; P3 is a 2-D
  resource scheduler, not a "param swap" — ship single-bottleneck-per-day first.

### Design (UX) — verdict: data model right, UX is "add fields + hope"
- **CRITICAL:** the routing op goes 5 → ~16 columns → **data graveyard**. Fix: row-summary +
  expand-to-edit drawer; **conditional fields by op type** (molding fields only for molding ops);
  inherited values as **greyed placeholders, never fake editable numbers**.
- **HIGH:** no way to tell a **measured standard from a guess**. Add a 3-level provenance affordance
  (measured / inherited-from-mold / default) on every number + a per-SKU "completeness meter" +
  an "estimated" badge on capacity output.
- **HIGH:** mold-override ambiguity → read-only inherited value + explicit "Override" action +
  "mold changed, override still active" drift warning.
- **HIGH:** OEE with no data reads as **broken** → distinguish "— not measured" from `0%`; frame
  emptiness as onboarding; fill in op-by-op.
- **MEDIUM/HIGH:** invert CapacityPlanner from "type a target UPH" to "**select SKU → show achievable
  output + bottleneck as the hero result**." That sentence is the whole reason the module exists.
- **MEDIUM:** ECN approval = ceremony in a one-engineer shop → ship **silent versioning + history +
  diff**, drop the approval gate, keep the table for the future.

### Decision Audit Trail
| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | Eng | Fix destructive `saveProcess` before P0 lands `routing_version_id` | Mechanical | P5 explicit | Versioning is a lie otherwise; claimed-done-but-absent |
| 2 | Eng | Enforce single-active via partial unique index + atomic flip RPC | Mechanical | P1 completeness | Reproduces the exact non-determinism a prior migration patched |
| 3 | Eng | Backfill: don't copy cycle for molding; inherit from mold; coverage report | Mechanical | P1 completeness | Silent-wrong on the core molding ops |
| 4 | Eng | Centralize WO-number mint + UNIQUE before P3 | Mechanical | P2 boil-lakes | In blast radius; cable safety |
| 5 | Eng | `routingCapacity.js`: clamp scrap<1, guard cycle/parallel/min-max, unit-test degenerates | Mechanical | P1 completeness | Preserve existing guards, don't regress |
| 6 | Design | Routing editor = drawer + conditional fields + inherited-as-placeholder | Mechanical | P5 explicit | Gate on whether data is ever entered correctly |
| 7 | Design | Provenance affordance + per-SKU completeness meter everywhere a number shows | Mechanical | P1 completeness | Gate on whether output is trusted |
| 8 | Design | Invert CapacityPlanner to SKU→achievable+bottleneck | Taste | P5 explicit | Better mental model; target-UPH demoted to what-if |
| 9 | CEO+Design | Ship silent routing versioning + history; DROP ECN approval workflow | **User Challenge** | — | Reduces user's stated P5 scope — surfaced, not auto-decided |
| 10 | CEO | Defer P3 (scheduler) + P4 (OEE dashboard) until real job-card data exists | **User Challenge** | — | Reduces user's stated scope — surfaced, not auto-decided |

### Recommended reduced plan
**Build now:** P0 (schema, additive) with Eng C1/C2/H1/H2 fixes baked in · P1 minimal routing
editor (Design fixes 1–3) · P2 capacity reads routing + the cavities formula fix (M1 guards).
**Defer (until operators post daily for ~2–3 weeks):** P4 OEE. **Defer (until SKU mix creates real
mold contention):** P3 finite scheduler. **Cut for now (keep table, skip workflow):** P5 ECN approval.

### ✅ LOCKED SCOPE (user decision, 2026-06-25): REDUCED
Build now, in order:
1. **P0 — schema (additive)** with eng fixes baked in: rewrite `saveProcess` to be version-scoped
   (C1); `routing_version` + partial unique index `WHERE status='active'` + atomic
   `mes_activate_routing_version` RPC (C2); category-aware backfill that inherits molding cycle from
   the mold and emits a coverage report (H1/H2). Add per-routing params + `mold_id` to `product_process_step`.
2. **P1 — minimal routing editor**: drawer with conditional fields by op type; inherited values as
   greyed placeholders (never fake editable numbers); mold-bind auto-fills cavities/cycle with explicit
   Override (Design 1–3). Silent versioning + a read-only revision-history tab. **No ECN approval UI.**
3. **P2 — capacity reads routing**: new pure `routingCapacity.js` (routing→mold→default fallback,
   divide-by-zero guards, unit-tested degenerates); rewire CapacityPlanner (invert to SKU→achievable+
   bottleneck) + LineBalancing; provenance badges on every number.
**Deferred:** P4 OEE (until ~2–3 weeks of real job-card postings) · P3 finite scheduler (until SKU mix
creates real mold contention). **Cut:** P5 ECN approval workflow (table kept, workflow skipped).
**Folds in:** the unshipped daily auto-planner (this session) becomes P2/P3 — its allocator + preview +
`mes_auto_commit_plan` survive; the flat molding pool is replaced by routing-driven capacity.

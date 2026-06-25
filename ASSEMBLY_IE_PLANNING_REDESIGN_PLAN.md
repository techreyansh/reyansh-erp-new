<!-- /autoplan restore point: ~/.gstack/projects/techreyansh-reyansh-erp-new/design-system-rollout-autoplan-restore-20260626-000605.md -->
# Assembly, Molding & Packing — Industrial Engineering Planning Engine (Redesign Plan)

**Date:** 2026-06-26 · **Branch:** design-system-rollout · **Status:** DRAFT for /autoplan review.

## 1. Problem & philosophy
The current Assembly/Molding/Packing planner schedules production. The factory needs a **decision-support engine** that, given a daily target, recommends the **lowest-cost, highest-efficiency** way to hit it. Optimization priority (hard order): (1) minimize manpower → (2) minimize overtime → (3) hit the daily target on time → (4) minimize inter-department WIP (rejection risk). Output is **engineering recommendations with reasoning**, not just a schedule.

## 2. What already exists (REUSE, do not rebuild)
Shipped this session (MES routing redesign P0/P1/P2, live in prod):
- `routing_version` + per-operation routing params incl. **standard cycle time**, mold binding; atomic `mes_save_routing` (C1) + single-active version index + `mes_activate_routing_version` (C2).
- `src/services/cablePlanner/routingCapacity.js` — cavities-aware UPH + bottleneck detection (16 tests).
- `CapacityPlanner` + `LineBalancing` UI reading the active routing.

**Decision the review must make:** the existing `routing_version`/operation model IS the Process Master backbone. We **extend** it with IE fields rather than build a parallel master. The capacity engine `routingCapacity.js` is the seed for the line-balancing engine.

## 3. The hard modeling decisions (for the reviewers)
- **D-A: Two capacity models, one operation table.** Labour-constrained station capacity = `operators / cycle_time` (parallel operators add capacity, bounded by `max_operators` and `parallel_stations_allowed`). Machine-constrained (molding) capacity = `machines × cavities / cycle_time`; operators do NOT add capacity; each machine needs a dedicated operator (operator count derived from machine count, not a lever). One `operation` row carries a `constraint_type` flag selecting the model.
- **D-B: Scenario optimizer algorithm.** Greedy bottleneck-relief (not LP/MILP): compute per-station required-vs-max capacity → relieve the binding bottleneck by the cheapest legal move (add operator where parallel allowed & < max; else overtime; molding → overtime or add machine if available) → re-balance → repeat until target met or no legal move. Each scenario A–E is a constrained variant of this loop. Rationale: explainable ("add 1 op to Pin Welding removes the bottleneck"), deterministic, no solver dependency.
- **D-C: Cost model inputs.** New `ie_cost_rates` (labour ₹/hr by dept/skill, overtime multiplier, machine ₹/hr, indirect %). Cost per scenario = Σ(operators × hours × rate) + overtime + machine-hours. Cost/pc = total / target qty.
- **D-D: WIP estimate.** Between consecutive ops, estimated WIP = throughput gap × build-ahead window; displayed, soft-penalized in scenario scoring (priority 4), never hard-blocks.

## 4. Proposed phased plan (eng gates BEFORE schema)
- **GATE C1 (eng):** confirm the operation-table extension vs a new master; confirm constraint_type model (D-A). No schema until signed off.
- **P0 — Process Master + resource/cost masters (schema + editor).** Extend `operation` with: department, station, machine_required, constraint_type (labour|machine), min_operators, max_operators, parallel_stations_allowed, quality_check, inspection_point, default_wip_buffer. New masters: `ie_workstation`, `ie_machine` (molding cell: 2 inner + 1 outer + 1 grommet, cavities, cycle_time), `ie_cost_rates`. Per-product flow editor (add/remove/reorder/duplicate/disable/replace) — extend the existing routing editor.
- **P1 — Line-balancing + bottleneck engine (pure functions + tests).** Per-station required UPH / max capacity / current vs target cycle time / utilization / capacity gap. Bottleneck analysis (machine/labour/cycle/capacity) with severity. Build on `routingCapacity.js`. Planner input form (qty, dispatch date, shift length, working hours, desired daily output) → required UPH/cycle/capacity.
- **P2 — Scenario engine + cost optimization.** Scenarios A–E (greedy optimizer, D-B), each with operators/overtime/completion/utilization/cost/score; assembly cost sheet comparing all; recommended highlighted. Recommendation engine (templated reasoning from the optimizer's binding-constraint trace).
- **P3 — Machine-level molding schedules + assembly station plans.** Independent per-machine schedule (sequence, start/finish, qty, operator, utilization); per-station assembly plan.
- **P4 — Dashboards.** Line balance, machine utilization, manpower, bottleneck, cost-comparison; management summary (target, capacity, recommended scenario, completion, bottlenecks, costs, efficiency, WIP).

## 5. NOT in scope (deferred)
Real-time shop-floor execution/MES capture (Factory Ops app already owns capture); finite cross-day scheduling/sequencing optimization; multi-line/multi-shift optimization; LP/MILP solver; learning-curve/efficiency-ramp modeling. P3/P4 deferrable behind P0–P2.

## 6. Premises (to confirm)
1. The factory plans **one product per line per day** with fixed manpower (the brief's shift rules) — not multi-product line mixing.
2. Molding cell composition (2 inner + 1 outer + 1 grommet) is the standard but must be **data-driven** (machine count per type configurable per product/cell).
3. Cost optimization can use **standard rates** (not live payroll) for v1.
4. "Minimize manpower first" means: prefer the plan with fewest total operator-hours that still hits target before recommending overtime.

---
## GSTACK REVIEW REPORT (/autoplan — CEO + Design + Eng, Claude voices; Codex absent)

**Verdict: NOT build-ready as written. The engine thinking is strong (8/10); the plan is built on a FALSE schema inventory, over-builds a 5-scenario + 5-dashboard platform when one screen delivers the value, and rests on a manufacturing premise that is probably false. Re-baseline + confirm one premise → build-ready.**

### Cross-phase themes (each flagged independently by 2+ reviewers — high confidence)
1. **[CRITICAL] The plan misnames its own foundation.** The IE fields P0 wants to "add" ALREADY EXIST: `constraint_type, cavities, parallel_machines, min/max_operators, oee, quality_check_required` are live on **`product_process_step`** (routing) + **`assembly_operation`** (generic master) from the shipped MES P0 migration. There is no `operation` table. The real engine is **`src/services/routingCapacity.js`** (not `cablePlanner/…`), already implements the dual labour/machine capacity model (D-A), and has 16 tests. → P0 is ~80% already shipped. "GATE C1: decide master vs extend" is already decided. **Rewrite §2/§4 against the real schema or a build agent will ADD duplicate columns to a non-existent table.**
2. **[CRITICAL] Over-build vs minimum lovable core.** Collapse the 5 scenarios + 5 dashboards into ONE screen — the **Planner Cockpit**: input bar → hero verdict (operators / OT / completion / cost-per-pc) → **plain-English recommendation card** ("Add 1 operator to Pin Welding → unlocks 5,000/day, no overtime, ₹X/pc") with an "Apply" action. CapacityPlanner + LineBalancing already ship this exact pattern. The recommendation card is the product's soul; tables are supporting evidence, never the headline. 6-month regret = over-build, not under-build.
3. **[CRITICAL design] Missing states — design the INFEASIBLE-target state first.** "You can't hit 8,000/day — max is 6,200 (Pin Welding capped). To reach it: +1 machine OR a 2nd shift OR move dispatch to the 9th." This is the most valuable screen and is entirely absent. Plus empty (no cost rates / no constraint_type → NaN/₹0 guards) and "estimated" provenance when cost uses default cycle times.
4. **[HIGH eng] Don't extend `routingCapacity.js` in place.** Keep it pure-capacity (cable production's CapacityPlanner/LineBalancing depend on it). Put cost + scenario + operator-derivation in a NEW layer (`ieScenario.js`/`costModel.js`) that CONSUMES it. The 16 tests stay green as the regression guard.
5. **[HIGH eng] Two real correctness bugs in the seed engine, must fix+test BEFORE building on it:** (a) `parallel_allowed=false` is ignored — `operatorsFor` will return >1 operator for a non-parallel station; (b) machine-only bottleneck blind spot — `lineCapacity` picks the bottleneck only among machine ops, so a maxed-out labour station slower than the slowest machine is NOT reported → the engine declares an unachievable target achievable.
6. **[HIGH eng] RLS gap.** `routing_version` + `engineering_change_note` shipped with NO RLS. New `ie_cost_rates` (₹/hr, payroll-ish) MUST get `ENABLE ROW LEVEL SECURITY` + policy in the same migration; retrofit RLS on the routing tables too.
7. **[HIGH eng] Molding cell ≠ scalar `parallel_machines`.** A cell (2 inner + 1 outer + 1 grommet, heterogeneous cycle/cavities) can't live on one row. Needs a child `ie_machine` relation FK'd to the molding step; `lineCapacity` sums throughput across the cell. FK target is subtle under routing-version supersede (bind to product+operation, not the version).

### Decisions (auto-decided via the 6 principles; logged below)
- **Reduce scope to the Cockpit core (P1).** Collapse A–E → recommended + one "no extra labour" toggle. Cut the 5 dashboards to ONE results panel. (P3 pragmatic, P1 completeness-of-the-core.)
- **New `ieScenario.js`/`costModel.js` layer; do NOT modify `routingCapacity.js`.** (P4 DRY, P5 explicit.)
- **Fix the 2 engine bugs + add tests first** (parallel_allowed clamp, mixed labour/machine bottleneck). (P1 completeness.)
- **Optimizer is a PURE function with a fixture test suite, moved into P1** (it's the product; build+prove the engine before masters/UI). (P5 explicit.)
- **WIP → display-only diagnostic, cut from scenario scoring.** (P3 pragmatic; the premise likely zeroes most inter-op WIP.)
- **RLS on every new master + retrofit routing tables.** (P1 completeness/security.)
- **Recommendation text says "lowest-cost plan found," not "optimal,"** until the optimizer algorithm is locked. (P5 explicit/honest.)

### TASTE decision (surfaced to user): optimizer algorithm
Eng pushed back on greedy: the search space is tiny (~5–10 stations, integer operators ≤ ~6), so a **bounded brute-force / branch-and-bound** is exactly optimal, still explainable (emit the binding-constraint trace of the winning plan), no solver dependency — and it eliminates greedy's two known failure modes (cascading downstream manpower; wrong machine-vs-labour move order). Recommendation: **bounded enumeration over greedy.**

### REDUCED build-ready scope
- **GATE C1a (eng, before schema):** molding-cell relation shape (`ie_machine` child rows + FK target under version-supersede).
- **GATE C1b (eng, before schema):** optimizer contract — pure-function signature, lexicographic objective + explicit total tie-break, bounded-enum vs greedy.
- **FIX-FIRST (blocker, not a phase):** the 2 `routingCapacity.js` correctness bugs + tests.
- **P1 (the MLC):** planner input form (≈80% exists) → `ieScenario.js` (pure, tested) producing ONE result: binding bottleneck + single cheapest legal relief move + cost + cost/pc + plain-English reasoning. `ie_cost_rates` master (the only genuinely-new schema) with RLS. The **Planner Cockpit** screen (verdict hero + recommendation card + Apply) reusing CapacityPlanner/LineBalancing patterns. The **infeasible-target** state.
- **P2 (after P1 is used):** recommended + "no extra labour" toggle; scenario cards (trade-off-labeled: Cheapest / Fastest / Balanced ✓ / Min-manpower) — NOT a 40-cell table.
- **DEFER:** per-machine molding schedules + per-station plans (P3); the 5 dashboards (P4) — build only post-adoption if asked.
- **CUT:** WIP scoring penalty; full A–E scenario set; "decide the master" gate (already decided).

### Consensus
CEO: not-build-ready, reduce to Target→Bottleneck→Cost loop. Design: 3/10 as a design plan, name the Cockpit + design the infeasible state first. Eng: reuse don't rebuild, fix 2 engine bugs + RLS first, pure+tested optimizer, prefer bounded enumeration. **All three converge: re-baseline against the real schema, confirm the manufacturing premise, ship the one-screen core over the existing engine.**

<!-- AUTONOMOUS DECISION LOG -->
| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | CEO | Reduce 5-phase platform → Cockpit core | Mechanical | P3/P1 | One screen delivers the value; rest is post-adoption |
| 2 | Eng | New ieScenario.js layer, don't touch routingCapacity.js | Mechanical | P4/P5 | Cable depends on it; 16 tests are the guard |
| 3 | Eng | Fix parallel_allowed + machine-bottleneck bugs first | Mechanical | P1 | Downstream numbers inherit a feasibility lie otherwise |
| 4 | Eng | Optimizer pure+tested, moved to P1 | Mechanical | P5 | The optimizer IS the product |
| 5 | CEO | WIP → display-only, cut scoring | Mechanical | P3 | Tuning knob nobody calibrates; premise zeroes most WIP |
| 6 | Eng | RLS on new masters + retrofit routing tables | Mechanical | P1 | ₹/hr data must not be open |
| 7 | Eng | Molding cell → child ie_machine relation | Mechanical | P1 | Scalar parallel_machines can't hold heterogeneous cell |
| 8 | Eng | bounded-enum vs greedy optimizer | TASTE | P5 | Tiny search space → exact + explainable; surfaced to user |
| 9 | CEO | one-product-per-line/fixed-manpower premise | PREMISE | n/a | Load-bearing; not auto-decided — user gate |

---
## DECISIONS LOCKED (premise gate + taste — user, 2026-06-26)

**APPROVED with these answers (they refine the model — the per-line draft assumption was wrong):**

1. **Manpower = FIXED TOTAL HEADCOUNT POOL.** The optimizer does NOT freely add operators. It allocates the day's fixed headcount across stations to hit target at min cost; "add an operator to Pin Welding" = draw one from the pool (one fewer available elsewhere) + its cost. If the pool can't hit target → overtime, then "need +N headcount" as an explicit infeasibility output. The lever is **reallocation within a fixed budget**, not free-add. (Consistent with the brief's "fixed allocation for the day, don't move mid-shift" — the optimizer decides that one allocation.)
2. **Molding = SHARED POOL across lines.** Molding (the 2-inner+1-outer+1-grommet cell) is a shared constraint feeding multiple assembly lines, not per-line. Molding feasibility is checked against the **remaining shared molding capacity** (the daily auto-planner already caps plans "by the shared molding pool" — REUSE that cap). Full cross-line co-optimization is deferred; v1 treats the shared molding pool + remaining headcount as **caps** on a single order's plan.
3. **Optimizer = GREEDY** (user chose over bounded brute-force). Greedy **reallocation**: move one operator from the highest-slack station to the binding bottleneck until balanced / target met / no legal move; then overtime; then report "need +N headcount or +1 machine." Keep it honest — recommendation text says "lowest-cost plan found," not "optimal." MUST be a **pure function** with an explicit total **tie-break** order (equal cost → lowest station index → lowest op id) for determinism, and a fixture test suite. Document greedy's known limits (cascading downstream manpower; machine-vs-labour ordering) as accepted.

### Refined v1 (build-ready) — single-order Cockpit honoring the shared caps
- **FIX-FIRST (blocker):** the 2 `routingCapacity.js` bugs (`parallel_allowed=false`→clamp to 1 operator; mixed labour/machine bottleneck = true min across machine cap AND each labour op's max-operator capacity) + tests. Keep the engine pure; cable's CapacityPlanner/LineBalancing depend on it.
- **GATE C1a:** molding-cell child relation `ie_machine` (FK to product+operation, not the superseded version) + shared-molding-pool capacity source (reuse the auto-planner's cap).
- **GATE C1b:** `ieScenario.js` pure-function contract — inputs (active routing steps, day's headcount pool + already-committed, remaining molding pool, cost rates, target, shift hrs), output (binding bottleneck + cheapest legal reallocation/OT move + cost + cost/pc + reasoning + feasibility), lexicographic objective + tie-break.
- **P1:** `ie_cost_rates` master (+RLS; retrofit RLS on `routing_version`/`engineering_change_note`); `ieScenario.js` + `costModel.js` (pure, tested) wrapping `routingCapacity.js`; the **Planner Cockpit** screen (input bar → verdict hero → recommendation card + Apply) + the **infeasible-target** state ("max X/day, need +N headcount / +1 mold machine / move dispatch"). WIP = display-only number.
- **P2 (post-adoption):** recommended + "no extra labour" toggle; trade-off-labeled scenario cards (Cheapest / Fastest / Balanced ✓ / Min-manpower), not a 40-cell table.
- **DEFER:** per-machine molding schedules + per-station plans; the 5 dashboards; full cross-line headcount/molding co-optimization. **CUT:** WIP scoring; full A–E set.

**Status: APPROVED — build-ready after FIX-FIRST + C1a + C1b. Next: build P1 (or /spec the FIX-FIRST + P1 as issues).**

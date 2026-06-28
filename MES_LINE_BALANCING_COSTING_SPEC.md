# Line Balancing & Costing Engine — Spec

**Date:** 2026-06-26 · **Branch:** design-system-rollout · **Module gate:** `production`
**Builds on:** `MES_ROUTING_REDESIGN_PLAN.md` (routing master = source of truth),
`MES_AUTO_PLANNER_SPEC.md` (day's mix allocator), `POWERCORD_MES_BLUEPRINT.md` (the spine).

## Thesis
For a given **line + day**, take that day's **mix of parts**, read each part's **flow from the
routing master**, and for **every stage** answer three questions:
1. How much must this stage produce to hit the day's target within the shift?
2. How much can it produce now (current people / machines)?
3. If there's a gap, what is the **cheapest** way to close it — more people, overtime, more
   machines, or a combination?

Then roll the whole flow into a **per-piece cost** so the user can see what each option costs the
company. This replaces the current "flat molding pool × shift hours" model, whose only knob is
*hours* — which is why everything currently collapses into "overtime."

## Decisions (locked with user, 2026-06-26)
1. **Options ranked by cost, cheapest first** (user can still pick any feasible option).
2. **Full per-piece costing**: material + direct labour + OT premium + machine + overhead.
3. **A user-maintained "Labour & Cost master"** supplies rates and caps (not hard-coded defaults).
4. **Mixed parts share the line** — stage load is summed across all parts running that day.
5. **Day's mix = auto-planner default, editable** on the balancing screen.
6. **Both manpower modes**: "compute heads needed" (default) and "distribute a fixed crew of N".
7. **Machine-vs-labour lever split** is the central mechanic (see below).

## The central mechanic — every stage is machine-bound or labour-bound
Read `constraint_type` from the routing op (falls back to Process Master default).

- **Machine-bound** (e.g. molding): `UPH = cavities × (3600 / cycle_time_sec) × OEE`.
  Adding **operators does not increase output** — only **more machines** (capped by compatible/
  parallel machines) or **overtime hours** help.
- **Labour-bound** (e.g. assembly, packing): `UPH = operators × (3600 / cycle_time_sec) × OEE`.
  Adding **operators** raises output directly (capped by `max_operators` / workstation cap);
  **overtime** is the alternative lever.

The engine selects the correct lever per stage automatically. Overtime is the universal fallback
available to both types.

## The math (pure, deterministic — per stage, for the day's mix)
Because parts share the line, each stage's load is summed across every part running that day:
```
required_seconds(stage) = Σ over parts [ qty(part) × cycle_time(part, stage) / output_per_cycle ]
required_seconds(stage) /= (1 − scrap_pct)          // inflate so GOOD output still hits target
available_seconds(stage) = resources × shift_hours × 3600 × OEE
```
- **Labour stage gap** → `operators_needed = clamp(ceil(required / per-operator-capacity), min_operators, max_operators)`.
  Anything still short after hitting `max_operators` → **overtime hours**.
- **Machine stage gap** → `machines_needed` capped by compatible/parallel machines → remainder → **overtime hours**.
- **Bottleneck** = the stage(s) that cannot reach target output even at their lever caps; flag explicitly.

`targetUPH` is derived from the day's target ÷ shift hours; shift length (8h / 10h / custom) is a
per-run input so the whole model flexes.

### Degenerate guards (must be unit-tested)
`scrap_pct → 1.0`, `cycle = 0`, `parallel_machines = 0`, `min_operators > max_operators`,
mold `status` inactive / tool-life exhausted → that stage's capacity is **zero**, surfaced as a
hard blocker (not a silent divide-by-zero).

## Two manpower modes (both ship)
- **Compute-heads (default):** size each labour stage up to its cap; overflow → OT. Output =
  "each stage needs N operators; total crew = …; plus H hours OT". Matches "suggest add 2 manpower".
- **Fixed-crew:** user enters "I have N operators today"; engine distributes them across stages to
  **level the bottleneck** (proportional to load), then fills any remaining gap with OT.

## Options generation + ranking (cheapest first)
For each bottleneck stage, enumerate every **feasible** way to hit target:
- pure manpower (if ≤ `max_operators`),
- pure overtime (hours needed),
- add machine (machine-bound stages, if compatible machines available),
- **combinations** (e.g. `+1 operator + 2h OT`).

Cost each option (see costing), then **sort ascending by added cost**. Present as a table; the
recommended (cheapest feasible) row is highlighted but any row is selectable.

Example (one stage):
| Option | People added | OT hours | Machines added | Extra cost/day | Hits target? |
|---|---|---|---|---|---|
| +3 operators | 3 | 0 | 0 | ₹X | ✅ |
| +1 operator + 2h OT | 1 | 2 | 0 | ₹Y (cheapest) | ✅ |
| 4h OT only | 0 | 4 | 0 | ₹Z | ✅ |

## Full per-piece costing sheet
For the chosen (or recommended) plan, rolled up across the whole flow:
```
cost_per_pc =
    material_per_pc                    // from ppc_bom / costing_version
  + direct_labour_per_pc               // base-hour operator wages ÷ good output
  + ot_premium_per_pc                  // OT hours × (multiplier − 1) × wage ÷ good output
  + machine_cost_per_pc                // machine-hours × machine_cost_per_hr ÷ good output
  + overhead_per_pc                    // overhead_rate applied per the master
```
Plus **total day cost**, and a **scenario-compare** panel (cheapest vs fewest-people vs all-OT)
showing cost-per-piece and total-cost deltas side by side. Exportable.

## Inputs & sources
| Input | Source |
|---|---|
| Per-part flow: stage, cycle time, cavities/mold, constraint_type, min/max operators, parallel machines, scrap%, OEE | **Routing master** (`product_process_step`, per `MES_ROUTING_REDESIGN_PLAN.md`) |
| Day's mix: {part, qty} per line | **Auto-planner** (`autoPlanner.js`) — pre-filled, editable |
| Wage/hr (per grade or stage), OT multiplier, max OT hours/day, max operators per workstation, machine cost/hr per machine type, overhead rate | **NEW: Labour & Cost master** (user-maintained) |
| Material cost per piece | **Reuse** `ppc_bom` + `costing_version` |
| Shift hours (8 / 10 / custom), working day | **Reuse** `shift_master`; shift length editable per run |

## Build vs reuse
**Reuse:** `routingCapacity.js` (per-stage standard + routing→mold→default fallback chain),
`autoPlanner.js` (day's mix), `molding_master`, `ppc_bom` / `costing_version` (material),
`shift_master`.

**New:**
- **Labour & Cost master** — table + maintenance screen (one row per grade/stage/machine-type as
  appropriate; role-scoped RLS, not `USING(true)`).
- **`src/services/lineBalance.js`** — pure, no Supabase import, unit-tested like `autoPlanner.js`.
  Functions: stage load roll-up across the mix, gap detection, option enumeration, costing, ranking.
  Returns plain data (no DB writes).
- **`src/services/lineBalance.test.js`** — covers the math, both manpower modes, and every
  degenerate guard.
- **Line Balancing screen** (rewrite of `LineBalancing.js`) — line+day picker → mix (planner-filled,
  editable) → shift hours → mode toggle (compute-heads / fixed-crew N) → per-stage result table with
  bottleneck flags + recommended cheapest plan → achievable output → cost summary.
- **Costing sheet component** — per-piece breakdown + scenario compare + export.

## UX notes (carry the prior design-review rulings)
- Provenance on every number: **measured / inherited-from-mold / default** badge; an **"estimated"**
  badge on any costing output that leans on default rates.
- Invert from "type a target UPH" to **"select line + day → show achievable output, bottleneck, and
  cheapest plan as the hero result."**
- Touch-friendly for non-technical floor/owner use; bar-chart line-balance view, not a Gantt.

## Scope flag (honest)
"Mixed parts sharing a line" + "full per-piece costing" is **larger than the reduced P2 scope** the
2026-06-25 `/autoplan` review locked — it pulls multi-part contention forward from the deferred
finite scheduler. This is the user's stated priority and overrides that reduction. The implementation
plan should still right-size delivery: **ship single-part balancing + costing first (proves the
engine end-to-end), then add multi-part contention as a fast-follow** — rather than building the 2-D
contention model blind. Per-part costing and the Labour & Cost master land in the first slice.

## Out of scope (this spec)
OEE actuals/dashboard (deferred until job-card data exists), ECN approval workflow (cut),
finite multi-day machine scheduling beyond the single-day mix contention described here.

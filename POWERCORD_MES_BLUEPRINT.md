# Power Cord Manufacturing Execution & Planning System (MES) — Blueprint

## Thesis
Turn the scaffolded Molding module into a real MES that runs **Customer Order → Cable Ready → Cutting → A/B Assembly → Inner/Outer/Grommet Molding → Folding → HV Test → Visual → Poly/Individual/Master Packing → Finished Goods**, fully configurable per product. Integration audit: **~65% reuse** of the existing PPC/shopfloor/cable-planner foundation. Effort: large — ~45-57 engineering-days of scope across 6 phases (AI-compressed, but still many phased build cycles).

## What already exists (reuse — do NOT fork)
- **Execution spine (LIVE):** `ppc_wo` (6-state WO), `ppc_wo_stage` (job-card-like: machine/operator/output/scrap/timestamps), `ppc_wo_material` (kit), `ppc_wo_qc` (QC gate). RPCs `ppc_create_work_order` / `ppc_advance_stage` / `ppc_record_qc` / `ppc_shopfloor`.
- **Capacity math (LIVE, pure/tested):** `cablePlanner/analytics.js` `capacityBoard` (per-machine util% + bottleneck) + `woDashboard.js`. Reuse for assembly/molding/packing.
- **Machines/lines:** `ppc_machines` (stage/speed/cavity/shift hrs/changeover), `ppc_lines`.
- **Routing:** `product_process_step` (per-product, EMPTY but schema-ready) + `routing_template`.
- **Quality:** `product_quality_plan` (just built) + `ppc_wo_qc`.
- **BOM/costing:** `ppc_bom` + `ppc_mrp`, `costing_version`.
- **Order→make→ship:** `sales_order` → `production_demand` → `dispatch_plan`; `inv_ledger`/`inv_balance`.
- **Molding UI scaffold (stub/demo):** `src/components/molding/` (PowerCordMaster stub, MoldingProductionPlanning partial, ProductionManagement demo). EXTEND + wire to live data — not rebuild.

## The #1 architectural decision — unify routing FIRST
Today routing is **hardcoded in the RPCs** (`ppc_create_work_order` / `cable_create_work_order` have `CASE item_type WHEN 'cable'/'power_cord'... THEN ARRAY[stages]`). Building the power-cord MES on top of that adds a third hardcoded branch and forks the work-order board + capacity math. **Fix before anything else:** refactor `ppc_create_work_order` to read the route from `product_process_step` (per product) / `routing_template`, with the hardcoded arrays as fallback. This also benefits cable production. Cross-cutting, so it's a deliberate call.

## New build (the masters + engines)
- **Masters:** `assembly_operation` (sheath removal / pin weld / crimp / sleeve / heat-shrink / tinning — std time/UPH/manpower/tools/quality), `assembly_a_side_config` + `assembly_b_side_config` (plug/pin/terminal/sleeve/cycle/quality), `molding_master` (mold no/customer/product/type/tool-life/cavity/machine-compat/location/status), `packing_master`, `shift_master`, `department`, `workstation`, `downtime_reason`, `defect_code`.
- **Engines:** line-balancing (bottleneck + manpower + balance%), daily production planning (load per dept from demand+capacity), department/machine/workstation scheduling (conflict detection), job-card capture (target/actual/reject/downtime/signatures), per-stage QC defect log + quality gate, production dashboard (KPIs/util/rejects/downtime/dispatch-risk).

## Phasing (from the audit)
1. **Foundation unification** — refactor routing RPC → `product_process_step`; build `assembly_operation` master + the configurable routing UI (add/delete/reorder/duplicate/modify). De-risks everything.
2. **Masters** — A/B-side config, molding master (+ machine compat + tool-life), packing master, shift/department/workstation masters.
3. **Job-card + QC** — extend `ppc_wo_stage` (planned/actual/downtime/reject + reasons), `downtime_reason` + `defect_code` + `qc_defect_log`, operator job-card UI, quality gate.
4. **Daily planning + capacity** — `daily_production_plan` + planner RPC, wire `capacityBoard` to assembly/molding, planning UI.
5. **Line balancing + dashboards** — bottleneck/manpower RPC, unified WO board, production KPI dashboard.
6. **Integration + hardening** — end-to-end SO→demand→plan→WO→stage→dispatch; audit/RLS/perf.

## Recommended Phase 1 (the de-risking spine)
Refactor routing to be configurable per product (kills the hardcoded-routing tech debt that would otherwise fork three ways) + the **Assembly Operation Master** + the **configurable routing editor** (reuses the routing editor pattern just built for NPD). Small, high-leverage, proves the spine before the master/engine fan-out.

## REVIEW FINDINGS (autoplan, single-voice — 3 independent Claude reviewers; Codex unavailable)

**USER CHALLENGE (all 3 voices, CEO loudest — NOT auto-decided): the full MES is strategically premature.** The whole ERP is days old; every table this MES feeds on has ZERO real data (production_hourly_log empty + no ingestion; no job cards ever posted; inv_ledger no live movements; no NPD projects). A line-balancing / workstation-scheduling / KPI-dashboard MES is "an instrument panel for a plane no one is flying." Binding constraint = shop-floor ADOPTION, not engineering. Recommended: **freeze MES after Phase 1; ship ONE thing — operator job-card capture wired to the live ppc_wo_stage spine for real cable production — gate all further phases on a real metric (N job cards/day for 2 weeks).** If capture fails you save ~50 days; if it works, the captured data tells you which of the 16 subsystems are worth building. User's direction (build full 6-phase MES) stands unless changed.

**Premise corrections (factual):**
- "Extend the molding module" — TRAP. PowerCordMaster/MoldingProductionPlanning/ProductionManagement (~4,400 LOC) are demo skins over Google-Sheet reads + hardcoded arrays. Treat as reference mockups, REBUILD the screens needed against ppc_wo. `AssemblyOperationMaster.js` is the good template.
- "cable_create_work_order has hardcoded routing" — FALSE. It reads stages from `payload->'stages'` (client-computed). **Phase 1 unified the wrong fork** — `ppc_create_work_order` (which the cable path doesn't call). Two un-reconciled WO creators now write the same ppc_wo/stage with different stage vocab + status. Must reconcile (shared `_ppc_wo_insert_stages` or route cable through ppc_create_work_order) before the unified board (Phase 5).
- "~65% reuse" = reuse of plumbing, NOT 65% of effort. New masters + engines are where the days live.
- **Phase 1 de-risks nothing in prod yet:** no power-cord ppc_item has a linked product+steps, so all power cords still hit the 5-stage hardcoded fallback. Phase 2 MUST backfill product rows + seed default routes from assembly_operation.

**MUST-FIX (real bugs in shipped Phase 1):**
- **`product.ppc_item_id` is NOT UNIQUE** → routing resolver `array_agg(... ORDER BY pps.sequence)` is non-deterministic if two products bridge one item (garbled/duplicated stages, silent). FIX: unique index on product.ppc_item_id (or dedupe + pick-one in the resolver).
- **RLS is `USING(true)` stubs** — assembly_operation (and every planned master) is writable by ANY authenticated user; app-side moduleAccess is bypassed by direct PostgREST/RPC. FIX: role-scoped RLS in Phase 2 (NOT deferred to Phase 6 = 4-phase exposure window); enforce all transitions + the quality gate INSIDE the SECURITY DEFINER RPCs.

**Taste decisions (auto-decided, recommended):**
- Job-card data model = **append-only `stage_execution_log`** (one row per operator-session), stage row actuals = SUM over log — solves concurrency (ppc_wo_stage is single-row + ppc_advance_stage has no lock → operators clobber). Not extend-in-place.
- Capacity = **fork a molding/assembly capacity fn** (effectiveUPH = cavities×3600/cycle for molding; operators×UPH for assembly, manpower as co-constraint). capacityBoard models only machine-hours; cavities don't even exist on ppc_machines. Don't overload the pure cable fn.
- Masters IA = **one grouped "MES Setup" hub + one reusable master component** (template off AssemblyOperationMaster), not ~10 scattered nav entries.
- Planning viz = **machine-lane day board + bar-chart line-balance**, not a Gantt (wrong for non-technical touch users); pick a chart lib (Recharts/MUI X).
- Job-card UI = **dedicated single-stage full-screen** (number-pad, chip-based reject/downtime, PIN/badge per-entry operator identity ≠ app session, offline save-state). Do NOT inherit ProductionManagement's dense table. This screen decides MES adoption.

**Eng must-fix before fan-out:** quality gate inside ppc_advance_stage; FK qc_defect/downtime_reason ON DELETE RESTRICT; reconcile WO-creator stage vocab + status; add moduleAccess rules per new route as each lands. Mobile: state device target per screen + card-reflow tables below md + fullScreen dialogs on xs.

## Integration (all exist)
Product Master · NPD · BOM (`ppc_bom`) · Costing (`costing_version`) · Sales Orders (`sales_order`→`production_demand`) · Inventory (`inv_balance`) · Dispatch (`dispatch_plan`) · Quality (`product_quality_plan`/`ppc_wo_qc`).

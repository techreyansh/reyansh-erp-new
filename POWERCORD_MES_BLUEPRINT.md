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

## Integration (all exist)
Product Master · NPD · BOM (`ppc_bom`) · Costing (`costing_version`) · Sales Orders (`sales_order`→`production_demand`) · Inventory (`inv_balance`) · Dispatch (`dispatch_plan`) · Quality (`product_quality_plan`/`ppc_wo_qc`).

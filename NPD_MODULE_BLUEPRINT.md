# NPD Module Blueprint — Reyansh International ERP

**Status:** Proposal for sign-off (2026-06-24). No code written yet.
**Mandate:** A complete Product Development Lifecycle system (customer requirement → approved production release), deeply integrated with CRM, Costing, Inventory, Purchase, Quality, Production, Dispatch, Product Master.

---

## 1. The thesis

> **NPD is not a new silo — it's an orchestration layer + a project spine on top of modules you already have.** A codebase audit found the hard parts are already built: the PLM `product` master (with revisions + documents + status development→sample→approved→production), the `costing_version` engine, the recursive `ppc_bom` + `ppc_mrp()` explosion, the `crm_pipeline` stage-gate pattern, the task system, and Supabase document storage. NPD adds a **project record that ties them together**, an **11-stage gate**, **sample + inspection tracking**, and a **Product Development Workspace** UI. Build the spine; reuse the organs.

This is exactly why NPD is feasible in phases: ~70% reuse, ~30% genuinely new.

## 2. What already exists (reuse, don't rebuild)

| NPD needs | Reuse | Verdict |
|---|---|---|
| Product record (part #s, revision, status, UPH) | `product` + `product_revision` + `product_document` (PLM) | ✅ production-grade |
| Costing (material/labour/machine/overhead, margin, target price) | `costing_version` + `costing_line` + `material_rate` + `plmCostingService` | ✅ reuse |
| BOM (multi-level, scrap, shortage, cost) | `ppc_items` + `ppc_bom` + `ppc_mrp()` RPC | ✅ killer reuse |
| Customer/prospect/owner link | `crm_pipeline` (customer_code) + `crm_pipeline_activity` | ✅ reuse |
| Stage-gate + history + kanban | `crm_pipeline` + `crm_pipeline_history` pattern | ✅ reuse pattern |
| Cross-dept tasks + proof | `task_templates` + `task_instances` (taskComplianceService) | ✅ reuse |
| Documents + version + AI extract | `documents` storage bucket + `product_document` + the Gemini `extract-production-log` Edge fn pattern | ✅ reuse |

**Must build new:** the `npd_project` spine, `npd_stage_history`, `npd_sample`, `npd_quality_check`/inspection, customer-feedback tracking, and the NPD workspace UI. Quality is currently a stub. There is **no existing NPD code** (only inert Sales/Purchase "sample/feasibility" step stubs).

## 3. Target architecture

```
                         npd_project  (the spine)
                         ─────────────────────────
  CRM ───customer_code──▶│ customer, contact, owner (sales+CRM+engineer)
  Product Master ─prod──▶│ product_id, customer/internal part #, type
  Stage gate ───────────▶│ stage (11), stage_entered_at, priority, target_date
                         │ status, approval, dates
                         └──┬───────┬────────┬────────┬────────┬────────┐
                            ▼       ▼        ▼        ▼        ▼        ▼
                      stage_history sample  quality  feedback  tasks   documents
                      (npd_*)      (npd_*) (npd_*)  (npd_*)  (reuse)  (reuse)
                            │        │        │
        Costing (costing_version) ◀─┘   BOM (ppc_bom) ◀─┘   MRP/Purchase (ppc_mrp)
```

- **`npd_project`** — the orchestration record: project_no, customer_code (→crm), product_id (→product, nullable until created), customer/internal part #, project_type (sample|drawing), priority, target_date, npd_engineer_email, salesperson_email, crm_email, stage, status, dates.
- **Stage gate (11):** Requirement Received → Technical Review → BOM Ready → Costing Ready → Material Ready → Sample Under Development → Testing → Sample Dispatch → Customer Feedback → Approved → Production Release. Trigger logs every transition to `npd_stage_history` (copy the crm_pipeline trigger pattern). No skipping (enforced server-side).
- **New tables:** `npd_stage_history`, `npd_sample` (version, storage_path, status, dispatched_at), `npd_quality_check` (test param, spec, measured, result), `npd_feedback` (sent_at, feedback_at, outcome approved|changes|rejected|resample, comments). Reuse `product_document` for files, `task_instances` for tasks, `costing_version`/`ppc_bom` for the costing/BOM tabs.
- **Production release:** on Approved → write/flip the `product` to status='approved'→'production', snapshot the approved BOM + costing + process; no duplicate entry (the data already lives in those tables).

## 4. UX — a Product Development Workspace (not a form)

- **NPD board (kanban):** columns = the 11 stages, cards = projects (customer, product, engineer, days-in-stage, priority, RAG status). Drag to advance (gate-checked). Reuses the crm-pipeline board pattern.
- **NPD 360 view (tabs)** — each tab is a *view over an existing module*, not new data entry:
  Overview · Customer (crm_pipeline) · Technical (review form) · **BOM (ppc_bom editor)** · **Costing (costing_version)** · UPH Analysis (product targets) · Material Status (ppc_mrp shortage) · **Quality (npd_quality_check)** · Sample Status (npd_sample) · Customer Feedback (npd_feedback) · Tasks (task_instances) · Documents (product_document) · Timeline (npd_stage_history) · Approvals.
- **Dashboards:** NPD dashboard (under-dev / awaiting costing / awaiting material / in sampling / awaiting feedback / approved / rejected / delayed / avg dev time) + a CEO management view (delayed, awaiting-action, ready-for-production).

## 5. Phased rollout (each phase shippable)

**Phase 1 — Project spine + workspace (the MVP).** `npd_project` + `npd_stage_history` + the 11-stage gate (server-enforced) + the kanban board + 360 **Overview/Customer/Timeline/Tasks/Documents** tabs + CRM link (customer_code) + document upload (reuse storage) + the NPD dashboard. This alone gives a real, usable development workspace.

**Phase 2 — Engineering & cost integration.** Wire the **BOM tab** (ppc_bom editor scoped to the project's product) + **Costing tab** (costing_version) + **Material Status** (ppc_mrp shortage → purchase) + **UPH/labour** (product targets). Technical Review form.

**Phase 3 — Samples, quality, feedback, release.** `npd_sample` tracking + `npd_quality_check`/inspection + `npd_feedback` + the **Production Release** that pushes the approved product/BOM/costing into Product Master.

**Phase 4 — Reporting + AI.** NPD reports (status, sample tracker, delayed, engineer performance, approval), CEO view polish, and **AI drawing/document analysis** (extend the Gemini Edge-function pattern). PPAP/APQP/ECN/ECR scaffolding.

**Defer:** customer portals, tooling management, full APQP document packs.

## 6. Risks & guardrails
- **Live prod + real users.** Additive tables; new `/npd` routes; new `MODULE_KEYS.NPD` + RBAC rule (so access is grantable in the matrix we just shipped). No changes to existing modules in Phase 1.
- **Don't fork masters.** NPD references `product`/`crm_pipeline`/`ppc_bom`/`costing_version` by id — never copies them. Production release flips status, doesn't duplicate.
- **Stage integrity.** Gate transitions server-side (trigger + RPC), history immutable.

## REVIEW FINDINGS (autoplan, single-voice — 3 independent Claude reviewers; Codex unavailable)

**Premise correction (factual):** the blueprint said "Product Master has no UI" — **false.** `src/pages/products/ProductMaster.js` is a full list + KPI + Product-360 (Costing/Process/Documents/Revisions tabs). So **"Production Release" is a status flip + `product_revision` snapshot, NOT a data copy** (no new product row, no BOM copy — flip `product.status`→production + release the chosen `costing_version`). The earlier audit was stale.

**USER CHALLENGE (all 3 voices, esp. CEO — NOT auto-decided): don't build NPD first.** ERP is freshly launched with few users; inventory is mid-rebuild (MRP still reads soon-to-be-legacy `ppc_stock`); Quality is a confirmed stub. NPD is the most cross-cutting module (touches 10) so it inherits every soft foundation. And there's no evidence the company runs a stage-gated NPD process on paper yet → risk of inventing the process and the tool at once. Recommended: finish the inventory MRP cutover, run 2-3 real new-product jobs through the *existing* Product Master + Costing + BOM manually for a few weeks, then build a re-scoped NPD.

**Reuse claims that are actually net-new (so "30% new" ≈ 40-45%):**
- **BOM↔product bridge doesn't exist** — `ppc_bom` keys on `ppc_items.id`, no `product_id` link (PLM migration admits "BOM↔product link deferred"). Phase 2 must add a bridge (`product.ppc_item_id` or `product_bom_map`) FIRST — it's not reuse.
- **Quality is a stub** — Phase 3 "reuse quality" = build the first Quality UI. Own it or keep a simple project-scoped inspection table.
- **Pre-product document storage** — `product_document.product_id` is non-null, but Phase 1 projects have no product yet → need a nullable `npd_project_id` on `product_document` or a small `npd_document` table. (HIGH Phase-1 gap.)

**Taste decisions (auto-decided, recommended):**
- Stage gate = **soft** (warn + advance-with-reason, log to history); only 2-3 truly hard gates (e.g. can't reach Production Release without Approved feedback). 11 hard non-skippable gates get worked around in a 5-user shop.
- 360 view = **~5 stage-aware sections** (Overview cockpit · Engineering [Technical/BOM/Costing/UPH/Material] · Samples & Quality · Activity [Tasks/Docs/Timeline] · Approvals), not 14 flat tabs. Full `/npd/:id` route, not a drawer.
- NPD spine RLS = **`USING(true)` module-gated** (match the PLM tables it orchestrates; CEO+engineers collaborate), with owner/engineer as filter columns, not RLS boundaries.
- Phase 1 includes the **Costing tab** (it already links to product_id and answers the CEO's "did it clear target margin?") — gives the MVP teeth so it's not a board nobody updates.

**Eng must-fix before build:** stage RPC enforces ordinality (no-skip) + re-checks caller (SECURITY DEFINER bypasses RLS) + optimistic lock (`WHERE stage = expected_from`); `npd_project.product_id` FK `ON DELETE SET NULL`; CRM link by `customer_code` text (not FK); RBAC = `MODULE_KEYS.NPD` + route rule + `modules` row + `role_module_permissions` backfill (copy the `20260623160000` quality/purchase pattern) or `/npd` defaults to dashboard; `npd_sample`/`npd_feedback` need a `revision`/`cycle` discriminator for re-sample loops. Reuse PPCFoundation `EmptyState`/skeleton; define the blocked-advance "why can't it move" UX + gate checklist.

## 7. The ask
1. Approve the **direction** (orchestration-over-existing-modules, 11-stage spine, phased).
2. Approve starting **Phase 1** (project spine + workspace + dashboard) — additive, no impact on current modules.

---
*Grounded in a codebase integration audit (product/costing/BOM/CRM/tasks/docs all mapped). See `~/.gstack/projects/reyansh-erp-new/NPD_MODULE_SPEC.md` for the full captured spec.*

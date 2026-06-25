# Product Lifecycle Management (PLM) — Design

_Design-first. The Product Master becomes the ERP's single source of truth for
"what we make." Everything else (CRM, Costing, Quotations, SOs, Production,
Cable Planning, MRP, Inventory, Purchase, Quality, Dispatch) **references** it.
Nothing built yet — for sign-off (step 9 = implement)._

---

## 1–3. Audit: current state, duplication, missing links

**Today there are 4+ overlapping "product" stores** — the core problem:

| Store | Type | Role today | Fate under PLM |
|-------|------|-----------|----------------|
| `products` | sheet (generic) | backs the **Product Management** screen (client_code, product_code, category, attachments) | **migrate → `product`** |
| `cable_products` | sheet (legacy) | older cable list | **migrate → `product`**, then retire |
| `cable_master` | relational | cable **specs** (cores, OD, strand, weight/m) | **keep** — `product` *references* it (no dup) |
| `power_cord_master` | sheet | moulding/power-cord specs | **keep** — `product` references it |

**Missing relationships:** product↔customer is only implicit (CRM JSON / quotation text); no product↔costing, product↔BOM, product↔process/routing, product↔revisions, product↔documents, product↔quality. Costing's draft `customer_product` (on hold) is really this same product entity.

**Decision:** ONE central **`product`** master. Specs that already live in
`cable_master`/`power_cord_master` are **referenced, never copied.**

---

## 4. PLM architecture — hierarchy

```
crm_pipeline (Customer: Crompton, C00012)
   └─ product_family  "Power Cords"           (lookup/tag, not a heavy table)
        └─ product     "3-Pin Power Cord 1.5m"  ← THE master record
             └─ product_revision  Rev A / Rev B / Rev C (history)
```
A `product` is owned by a customer (or `customer_code = NULL` for an internal/catalog product). Every other module points at `product.id`.

---

## 5. Database schema (new + reconciled)

### `product` — the master
```
id uuid pk
product_code text UNIQUE          -- internal/system code (auto: PRD-…)
customer_code text                -- → crm_pipeline.customer_code (null=catalog)
company_name text
customer_part_no text
internal_part_no text
product_family text               -- "Power Cords" | "Cables" | "Harnesses"
product_category text
product_type text                 -- 'cable'|'power_cord'|'harness'|'custom'
product_name text
status text                       -- development|sample|approved|production|inactive|obsolete
current_revision text             -- "Rev C"
-- specification (editable, jsonb for flexibility + typed common fields)
voltage_rating text, current_rating text, length_mm numeric, weight_g numeric,
dimensions text, packaging_standard text, tech_spec jsonb,
-- spec references (NO duplication)
cable_master_id uuid → cable_master.id,
power_cord_master_id uuid,        -- → power_cord_master
-- targets & productivity
target_per_hour numeric, target_per_shift numeric, target_per_day numeric,
target_per_month numeric, cycle_time_sec numeric,
-- manpower (simple counts; detailed per-step in product_process_step)
operators_reqd int, inspectors_reqd int, packers_reqd int,
machine_reqs jsonb,               -- {moulding, assembly_line, testing_station}
-- quality
quality jsonb,                    -- {inspection_params[], standards[], acceptance[], bis[], checklists[]}
-- moulding/tooling
moulding jsonb,                   -- {inner_mould, outer_mould, mould_no, tool_no, cavity, tool_owner, tool_location, tool_life, maintenance[]}
-- governance
created_by_email, created_at, updated_at, archived_at
```
> jsonb for spec/quality/moulding keeps it editable & evolvable without a migration per field; common filterable fields are typed columns.

### `product_revision` — revision history
```
id, product_id → product.id, revision text, status text,
changed_by_email, changed_at, change_reason text, snapshot jsonb (the product at that rev)
```

### `product_process_step` — routing
```
id, product_id, sequence int, step_name text (Cutting/Stripping/Crimping/Assembly/Testing/Packing),
department text, machine text, standard_time_sec numeric, manpower int, notes
```

### `product_document` — drawings/SOPs/PPAP/certs (reuses the `documents` storage bucket)
```
id, product_id, doc_type text (customer_drawing|internal_drawing|bom|work_instruction|
   testing_sop|photo|video|approval|ppap|certificate), file_name, storage_path,
   version text, uploaded_by_email, created_at
```

### Reconciled links (no new product tables elsewhere)
- **BOM:** `bom_templates` gets `product_id` (link, don't duplicate).
- **Costing (revise the held migration):** `costing_version.product_id → product.id`; **drop the standalone `customer_product`** (the `product` master already carries customer + revision). Costing keeps `costing_line`, `material_rate`, `costing_template`, `costing_status_log`.
- **Quotations / SOs:** reference `product.id` + the released `costing_version`.
- **Production / Cable Planning / MRP / Inventory / Quality / Dispatch:** all key off `product.id`.
- **Audit:** `master_audit_trigger()` on `product` (who/when/old→new), plus `product_revision` for rev-level history.

### Consolidation migration (one-time)
Map `products` + `cable_products` rows → `product` (product_code, name, customer, category); where a cable code matches `cable_master.cable_code`, set `cable_master_id`. Keep old tables as **read-only compat views** during transition; retire after.

---

## 6. Product 360 screen (wireframe)

```
┌ 3-Pin Power Cord 1.5m · Crompton · PRD-00142 · Rev C · 🟢 Production ───────────┐
│ [Overview][Specs][Cable][Moulding][BOM][Costing][Process][Targets][Inventory]   │
│ [Quality][Documents][Revisions][Activity]                          [⋯ actions]  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ OVERVIEW                                                                          │
│  Customer  Crompton (C00012)      Family   Power Cords                            │
│  Type      Power cord             Cust P/N  CR-PC-15                               │
│  Status    Production  ▾          Revision  Rev C                                  │
│  Latest costing  V5 ✅ ₹490 · 20%   BOM ✅   Docs 6   Missing: —                   │
│  ┌ health ─────────────────────────────────────────────────────────────────┐    │
│  │ Spec ✓  Cable-linked ✓  BOM ✓  Costing ✓  Drawing ✓  Quality ⚠ (no BIS) │    │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│  CABLE tab → references Cable Master CB-001 (3C×1.5, round) — read-only mirror    │
└───────────────────────────────────────────────────────────────────────────────────┘
```
Every tab editable (jsonb-backed). Cable/Moulding tabs show **referenced** master data (edit jumps to Cable Master).

**Dashboard:** Total · Development · Sample · Approved · Obsolete · **Missing documents** · **Missing costing**.

---

## 7. Integrations (product.id is the join key everywhere)
- **CRM/Client 360:** products purchased / quoted / under-development / sampling / lost (by `customer_code` + status).
- **Quotation:** pick customer → product → auto-fetch spec + released costing + revision + BOM + price.
- **Costing:** `costing_version.product_id` → the master (replaces `customer_product`).
- **Production/Cable Planning:** routing from `product_process_step`; cable specs from the referenced `cable_master`.
- **MRP/Inventory/Purchase:** materials from the product's BOM.
- **Quality:** `product.quality` drives inspection/test plans.
- **Performance/MIS:** targets from `product` (per-hour/shift/day) feed output vs target.

## 8. Governance
- Create / Edit / Duplicate / Archive / Deactivate / Delete / Restore — all audited (`master_audit_log` + `product_revision`).
- **Dependency check before delete:** block (or soft-archive) if referenced by any `costing_version`, quotation, sales order, production order/WO, or inventory — show what's blocking. Hard delete only when clear.

---

## 9. Implementation phases (after approval)
1. **Schema** — `product` + `product_revision` + `product_process_step` + `product_document`; add `product_id` to `bom_templates`; **revise costing** (`costing_version.product_id`, drop `customer_product`); audit trigger + RLS. *(One migration; supersedes the held costing Phase-1.)*
2. **Consolidation** — migrate `products`/`cable_products` → `product`; compat views.
3. **Product 360 UI** — list/dashboard + the tabbed 360 view (all tabs editable), document upload (reuse `documents` bucket).
4. **Governance** — duplicate/archive/restore/delete + dependency check + revisions tab.
5. **Integrations** — wire Costing → product; Quotation auto-fetch; CRM client-360 product lists.

> Because PLM is the master, **Costing Phase 1 is folded into PLM Phase 1** (one
> coherent migration) instead of being applied separately — no duplicate product.
```

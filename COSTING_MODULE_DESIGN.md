# Costing & Pricing Management Module — Design

_Design-first deliverable (analyze → model → wireframes → approve → implement).
Grounded in the existing ERP: customers in `crm_pipeline`, products in
`cable_master` / `power_cord_master`, BOMs in `bom_templates`, audit in
`master_audit_log`. Nothing here is built yet — this is for sign-off._

---

## 1. Current state (analysis)

| Area | Today | Gap to close |
|------|-------|--------------|
| Costing | `/costing` = transient calculator (`costing_data`, copper/PVC formulas, hardcoded rates 700/100) | No versions, no approval, no product/customer link |
| Quotations | `SendQuotation.js` → prices are **`Math.random()`** | Must pull the latest **approved** costing |
| Material rates | Hardcoded per component | Need a central, dated **rate master** |
| Customers | `crm_pipeline` (`customer_code` C/PC…) | Reuse as-is |
| Products | `cable_master`, `power_cord_master`, generic `products` | Need a **customer↔product** link + revisions |
| BOM | `bom_templates` (material lines, no cost) | Feed **auto-costing** |
| Audit/approval | `master_audit_log` + trigger; CRM stage+history pattern | Reuse for costing approval |

**Principle:** reuse customers/products/BOM/audit; add a versioned, approved
**costing engine** in the middle and wire quotations + SOs to consume it.

---

## 2. Data model (proposed new tables)

```
crm_pipeline (customer)                         ← exists
   └─ customer_product            (NEW)         a product a customer buys (+ drawing/rev)
        └─ costing_version        (NEW)         one costing revision (draft→released)
             ├─ costing_line       (NEW)        every cost component (material/labour/…)
             └─ costing_status_log (NEW)        approval history (who/when/why)
costing_template                  (NEW)         reusable cost-structure + external format
material_rate                     (NEW)         central dated rates (copper/PVC/pins…)
costing_status_log → also mirrors to master_audit_log via trigger
quotation pulls released costing_version (read-only)
```

### 2a. `customer_product` — the Customer Product Library
```
id uuid pk
customer_code text            -- → crm_pipeline.customer_code
company_name  text            -- denormalized for display
product_kind  text            -- 'cable' | 'power_cord' | 'harness' | 'custom'
product_ref_id uuid           -- → cable_master.id / power_cord_master.id (nullable for custom)
product_code  text            -- e.g. PC-1.5M
product_name  text            -- "Power Cord 1.5m"
drawing_no    text
drawing_url   text            -- storage 'documents' bucket
current_revision text         -- "Rev C"
status        text            -- 'active' | 'archived'
created_by_email, created_at, updated_at, archived_at
UNIQUE (customer_code, product_code)
```

### 2b. `costing_version` — a costing revision
```
id uuid pk
costing_no    text            -- "CST-CROMPTON-PC15-V5"  (human readable)
customer_product_id uuid      -- → customer_product.id
customer_code text, product_name text   -- denormalized
revision      text            -- product revision this costs (e.g. "Rev C")
version_number int            -- 1,2,3… auto-increment per customer_product
mode          text            -- 'auto' (from BOM) | 'manual'
template_id   uuid            -- → costing_template.id
status        text            -- 'draft' | 'reviewed' | 'approved' | 'released' | 'superseded'
effective_date date
-- INTERNAL summary (computed from lines) --
material_cost numeric, labour_cost numeric, machine_cost numeric,
overhead_cost numeric, financial_cost numeric, total_cost numeric,
target_margin_pct numeric, net_selling_price numeric,
contribution_pct numeric, gross_margin_pct numeric, net_margin_pct numeric,
qty_basis numeric default 1,           -- cost per N pieces / per meter
uom text default 'piece',
-- approval --
created_by_email, reviewed_by_email, approved_by_email,
approved_at timestamptz, released_at timestamptz,
change_reason text,
created_at, updated_at
UNIQUE (customer_product_id, version_number)
```

### 2c. `costing_line` — every cost component
```
id uuid pk
costing_id uuid               -- → costing_version.id (cascade)
section   text                -- 'material' | 'labour' | 'machine' | 'overhead' | 'financial' | 'profit'
category  text                -- 'Copper','PVC','Pins','Crimping','Depreciation','Rejection'…
material_code text            -- optional → material_rate.material_code
qty       numeric, uom text
rate      numeric             -- pulled from material_rate (overridable)
rate_overridden boolean default false
amount    numeric             -- qty*rate (or manual)
is_percentage boolean default false   -- e.g. overhead = % of material
pct_basis text                -- 'material'|'total'|… when is_percentage
sequence  int, notes text
```

### 2d. `costing_template`
```
id uuid pk
name text                     -- "Power Cord Costing", "Export Costing", "OEM"
product_kind text
sections jsonb                -- the cost sections + default categories to seed a sheet
external_format jsonb         -- how the CUSTOMER sheet rolls up internal lines (see §5)
is_active boolean, created_by_email, created_at, updated_at, archived_at
```

### 2e. `material_rate` (central, dated)
```
id uuid pk
material_code text            -- 'COPPER','PVC_INS','PVC_SHEATH','PIN_6A','TERMINAL'…
material_name text
rate numeric, uom text        -- ₹/kg, ₹/pc…
effective_from date, effective_to date (null=current)
source text                   -- 'manual'|'LME'|'supplier'
created_by_email, created_at
```

### 2f. `costing_status_log` (approval history)
```
id, costing_id, from_status, to_status, changed_by_email, changed_at, reason
```
Plus a `master_audit_trigger()` on `costing_version` for field-level who/when/old→new.

---

## 3. Customer → Product → Costing → Quotation flow

```
Crompton (crm_pipeline C00012)
  ├─ Power Cord 1.5m  (customer_product, Rev C, drawing FM/RI/…)
  │     ├─ V1 superseded   ├─ V4 superseded
  │     └─ V5 RELEASED  ← quotations auto-pull this
  └─ Wiring Harness A (customer_product)
        └─ V3 RELEASED

Quotation Q-125:  pick Crompton → pick "Power Cord 1.5m"
   → system fetches V5 (released): net_selling_price, margin, revision
   → no manual recalculation
```

---

## 4. Internal cost sheet (full structure — costing_line `section`/`category`)

- **Material** — Copper · PVC · Pins · Terminals · Connectors · Sleeves · Labels · Packing · Other
- **Labour** — Cutting · Stripping · Crimping · Assembly · Testing · Packing
- **Machine** — Running cost · Depreciation · Power · Tooling
- **Overheads** — Factory · Quality · Admin · Maintenance · Rejection · Scrap
- **Financial** — Interest · Inventory carrying
- **Profit** — Target margin %

**Computed summary:** Material/Labour/Machine/Overhead/Financial totals →
**Total cost/pc** → +margin → **Net selling price** → Contribution % · Gross % · Net %.
Live margin calculator recomputes as any line/rate changes.

---

## 5. External (customer) cost sheet — configurable

The customer NEVER sees profit/overheads/internal structure. `costing_template.external_format`
maps internal sections → customer buckets:

```
Option A (Conversion):   Material | Conversion | Packing | Total
Option B (Material split): Copper | PVC | Accessories | Packing | Total
Option C (Custom):        any buckets, each = sum of chosen internal sections/categories
```
External price = the released `net_selling_price`; buckets only change how it's *presented*.

---

## 6. Versioning + approval workflow

```
draft ──submit──▶ reviewed ──approve──▶ approved ──release──▶ released
  ▲                                                              │
  └──────────────── new revision (V+1) ◀── supersede ───────────┘
```
- Only **released** costings are selectable in quotations/SOs.
- Releasing a new version auto-**supersedes** the prior released one.
- Every transition → `costing_status_log` (+ reason); every field edit → `master_audit_log`.
- RLS: creator/owner + reviewer/approver roles; CEO sees all (reuse CRM pattern).

---

## 7. Auto vs manual costing
- **Auto:** if a BOM exists (`bom_templates` for the product) → seed `costing_line`s from
  BOM material lines × `material_rate`; labour/machine/overhead from the template defaults.
  Any line is overridable (`rate_overridden`).
- **Manual:** start from a template with empty lines; user types material/labour/machine/
  overhead/profit; system computes price. (For costing done before BOM is final.)

---

## 8. Reports & price control
- **Price control banner** on quotation: Current cost · Selling price · Margin % vs **Target**
  & **Minimum** → red warning if below target/min.
- **PDFs:** Internal Cost Sheet · Customer Cost Sheet (external format) — via existing
  `reportEngine.js`.
- **Analytics:** Customer-/Product-/Quotation-/Order-wise profitability · Monthly margin ·
  Revision comparison (V4 vs V5 diff) · Cost-change report (from audit log).
- **Future-ready:** `material_rate` is dated → a copper/PVC update triggers an
  **auto-recost** preview + cost-impact analysis across affected released costings.

---

## 9. Wireframes (ASCII)

**A. Customer Product Library** (inside a customer / standalone)
```
┌ Crompton · Costing ───────────────────────────── [+ Add product] ┐
│ Products            Rev   Latest costing   Margin   Quotation     │
│ ─────────────────────────────────────────────────────────────────│
│ Power Cord 1.5m     C     V5 ✅Released     22%     Q-125 · SO-225 │
│ Power Cord 2m       B     V3 ✅Released     19%     Q-140          │
│ Wiring Harness A    A     V2 🟡Approved     —       —              │
└───────────────────────────────────────────────────────────────────┘
```

**B. Costing editor** (tabbed, "estimating software" feel)
```
┌ CST-CROMPTON-PC15-V6  · Power Cord 1.5m · Crompton · 🟡 Draft ─────────────┐
│ [Material][Labour][Machine][Overheads][Financial][Summary][Versions]      │
│ MATERIAL                                              auto from BOM ▾      │
│  Copper        0.42 kg  × ₹745/kg  = ₹312.90      [override]              │
│  PVC ins       0.18 kg  × ₹110/kg  = ₹19.80                              │
│  Pins (6A)     1 pc     × ₹14.00   = ₹14.00                              │
│  …                                                                        │
│ ┌ Live margin ───────────────────────────────────────────────────────┐  │
│ │ Total cost ₹/pc 392.10 · Target 20% · Sell ₹490 · Margin 20.0% ✅   │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
│                          [Save draft] [Submit for review] [Preview PDF]   │
└───────────────────────────────────────────────────────────────────────────┘
```

**C. Version timeline + approval**
```
V6 Draft (you)  →  V5 ✅Released 02-Jun (appr. CEO)  →  V4 Superseded  →  V3 …
[Compare V5↔V6]  [Internal PDF] [Customer PDF]      reason: "copper +6%"
```

**D. Quotation integration**
```
New quotation → Customer [Crompton ▾] → Product [Power Cord 1.5m ▾]
  ↳ auto: costing V5 · cost ₹392 · target 20% · suggested ₹490 · margin 20% ✅
  Qty [500]  Price [₹490]  ⚠ below target if <₹470
```

---

## 10. Suggested implementation phases (after approval)
1. **Schema + rate master** — the 6 tables + audit trigger + RLS + `material_rate` seed.
2. **Customer Product Library** — CRUD + drawings (reuse `documents` bucket).
3. **Costing editor** — tabs, lines, live margin, auto-from-BOM + manual; save/version.
4. **Approval workflow** — draft→reviewed→approved→released + status log + audit.
5. **Quotation/SO integration** — pull released costing; price-control banner.
6. **Reports** — internal/customer PDF, margin & revision-comparison analytics.

Each phase is a migration (your approval) + UI + tests, shipped via the daily deploy.
```

# Sales Order — Order Initiation Engine — Design

_Design-first. The Sales Order is the trigger event for the whole
Order-to-Dispatch workflow. It sits on top of PLM (product master) + Costing
(released version). Nothing built yet — for sign-off (step 10 = implement)._

---

## 1–4. Audit / gaps / dependencies

**Today:** `POIngestion.js` (AI PO capture via the `extract-purchase-order`
Gemini edge function) + a create-order form → sheet-style **`client_orders_data`**;
lifecycle loosely tracked in **`crm_order_cycle`**. Line items are **free-text**,
no link to a product master, **no costing pull**, no validation, no real status
state machine, no exception engine, no Order-360.

**Gaps to close:** product-master line items (no free text), auto-fetch released
**costing**, mandatory PO PDF + versioning, validation gate, order analysis,
proper **status state machine**, release-triggered integrations, Order-360, dashboard.

**Dependencies:** **PLM `product`** (line items) and **Costing `costing_version`**
(price/margin) must exist first → SO is built **after** PLM+Costing land.

---

## 5–6. Order-to-Dispatch architecture + schema

```
crm_pipeline (customer) ─┐
PLM product ─────────────┤→ sales_order ─→ sales_order_line ─→ (product_id, costing_version_id)
costing_version ─────────┘        │
                                  ├─→ sales_order_document (PO PDF + drawings, versioned)
                                  ├─→ sales_order_status_log (timeline)
                                  └─ on RELEASE → production demand + MRP + inventory reserve + CRM activity + forecast
```

### `sales_order` (header)
```
id uuid pk
so_number text UNIQUE              -- SO-YYMMDD-NNN
customer_code text, company_name text
po_number text, po_date date, po_revision text, po_validity date
customer_ref text, buyer_name text, contact text
payment_terms text, special_instructions text
expected_delivery_date date, expected_dispatch_date date
status text                        -- state machine (below)
total_qty numeric, total_value numeric, margin_est_pct numeric
material_estimate jsonb            -- rolled from BOM × qty
owner_email, created_by_email, created_at, updated_at, released_at
```

### `sales_order_line`
```
id, so_id → sales_order.id (cascade),
product_id uuid → product.id,        -- PLM master; NO free text
product_code text, product_name text, customer_part_no text, revision text,
qty numeric, uom text, unit_price numeric, line_value numeric,
costing_version_id uuid → costing_version.id,   -- the released costing used
required_delivery_date date, lead_time_days int, on_hand_qty numeric, remarks text,
sequence int
```

### `sales_order_document` (PO PDF mandatory; reuse `documents` bucket)
```
id, so_id, doc_type (po|drawing|spec|approval|email|other), file_name, storage_path,
version text, uploaded_by_email, created_at
```

### `sales_order_status_log` — the timeline
```
id, so_id, from_status, to_status, changed_by_email, changed_at, note
```
+ `master_audit_trigger()` on `sales_order` for field-level history.

### Status state machine (only **Released+** triggers planning)
```
Draft → Pending Review → Approved → Released → In Planning → In Production
      → Partially Dispatched → Dispatched → Closed        (Cancelled from any pre-Dispatched)
```

---

## 7. Order 360 view (tabs)
Overview · Customer · PO Document · Line Items · Planning · Production · Inventory Allocation · Dispatch · Invoice · Payment · Activity · **Timeline** (PO received → created → approved → released → production start/complete → QC → dispatched → invoiced → paid).

## 8. Dashboard
Orders received today · pending review · released · in production · delayed · ready-to-dispatch · order value · **fulfilment %**.

---

## 9. Wireframes

**6-step wizard** (with AI PO capture pre-filling steps 1–3):
```
[1 Customer] → [2 PO details] → [3 Products] → [4 Validation] → [5 Review] → [6 Release]
 ───────────────────────────────────●────────────────────────────────────  progress

Step 1 Customer:  [Crompton ▾]   Status Active · Credit ₹20L · Outstanding ₹3.2L
                                 Salesperson Rahul · Last order 12-May
Step 3 Products (from Product Master — no free text):
  + add → [3-Pin Power Cord 1.5m ▾]  Rev C  Qty[500] UOM[pc]
     auto: costing V5 ₹490 · lead 7d · on-hand 0 · cust P/N CR-PC-15
Step 4 Validation (gate before save):
  ✅ Product exists  ✅ Rev approved  ✅ Costing released  ✅ BOM  ⚠ Route missing  ❌ Inventory short
Step 5 Review:  Total 500 pc · ₹2,45,000 · margin ~20% · material est ₹1.6L · exp dispatch 30-Jun
Step 6 Release:  [Save draft] [Submit review] [Release ▶]  (Release triggers planning/MRP)
```

**Exception flags** (dashboard + per-order): missing costing/BOM/drawing · inventory shortage · capacity constraint · **credit limit exceeded** · delayed/overdue.

---

## 10. Release-triggered integrations
On **Released**: create production demand (cable_production_plan / ppc work orders), MRP demand (BOM × qty vs stock), optional inventory reservation, CRM activity + `crm_order_cycle` row, revenue-forecast update.

## Reports
SO register · pending orders · production-demand · customer-wise · monthly · fulfilment · revenue forecast (via `reportEngine.js`).

## Implementation (after PLM + Costing)
1. Schema (sales_order + line + document + status_log) + audit + RLS.
2. Wizard (reuse AI PO capture to prefill) + product-master line items + costing auto-fetch.
3. Validation + analysis engine. 4. Status state machine + release integrations. 5. Order 360 + dashboard + exceptions. 6. Reports.

> **Build order:** PLM → Costing → **Sales Order**. SO can't be correct until the
> product master + released costings exist to reference.
```

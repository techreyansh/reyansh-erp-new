# CRM Integration & Upgrade Analysis

Comparing the live Google-Sheet CRM (`Reyansh_CRM_Tracker`) against the ERP's current CRM, and a plan to make the ERP do what the sheet does.

Date: 2026-06-13.

---

## 1. The honest headline

Your Google-Sheet CRM is **more coherent than the ERP's CRM today.** It is a genuinely well-architected system:

- **One join key — Company Name.** A company is added **once** in `01_Lead_Master`; every other sheet picks it from a dropdown and auto-fills. "Enter data once, it flows everywhere."
- **Auto-calculated fields** the user never types: Last Contact, Last Interaction, Days Left, Weighted Value, Last Order Date, AR aging, funnel/win-rate, all dashboard KPIs.
- **A daily driver** (`07_Today_Followups`) that auto-pulls overdue / due-today actions — the one screen the team clears every morning.
- **Full AR**: `14_Payments_Tracker` + `15_Payment_Dashboard` — invoice → terms → due date → balance → days-past-due → 6-bucket aging → top-5 debtors, all automatic.
- **Discipline built in**: Lost-Lead analysis (reason codes, competitor, learnings), weekly/monthly review cadence, centralized reference lists.

**Live volume:** 148 leads, 98 customers, ~298 next-action/pipeline rows, ~298 payment rows, contacts directory.

The ERP, by contrast, has *most of these entities* but they're **fragmented**: client data is split across `clients2`, `prospects_clients`, and an unused normalized `crm_leads` table; the CRM UI writes to legacy sheet-style tables (`CRM_Opportunities`, `CRM_Activities`, …) through **nine separate dialogs**; there's **no unique key or dedupe** on company; and almost nothing auto-calculates. **Crucially, the real prospect/customer data lives in the sheet, not the ERP** — which is exactly the mismatch you flagged.

**Recommendation: make the ERP adopt the sheet's model, then import the sheet's data.** Don't rebuild the sheet's ideas from scratch — port them.

---

## 2. The problem statements the sheet solves (and the ERP must)

| # | What the sheet does | ERP today | Action |
|---|---|---|---|
| 1 | **Single account registry** — company added once, joined everywhere | 3 disconnected stores (`clients2`, `prospects_clients`, `crm_leads`), no unique key, no dedupe | Make `crm_leads` the single Lead Master with a UNIQUE company key; define lead→customer promotion |
| 2 | **Enter once → flows everywhere** (auto fields) | Manual re-entry across 9 dialogs; clientCode typed repeatedly | Auto-derive Last Contact / Last Interaction / Days Left / Weighted Value / Last Order Date |
| 3 | **Today's Follow-ups** daily driver (overdue/due-today, RED/YELLOW) | A Follow-ups list exists but no "clear-it-daily" driver | Build a Today view fed by Next Action due dates |
| 4 | **Opportunity pipeline** w/ probability × value = weighted, blocker/next-step | Deals/Opportunities exist but weighted value & blocker not first-class | Add weighted value + blocker; Kanban already exists (`DealsKanban`) |
| 5 | **Lost-Lead analysis** (reason code, competitor, learnings) | Missing | New entity + simple analysis view |
| 6 | **AR aging** (6 buckets, DPD, top debtors) | `client_payments_data` + a Collections list, no aging | AR aging dashboard from payments |
| 7 | **Weekly / Monthly review** cadence | Missing | Review views (auto metrics + typed comments) |
| 8 | **Centralized reference lists** (salesperson, status, stage, source, industry, product) | Hard-coded enums scattered in code | One reference table powering dropdowns |
| 9 | **Contacts directory** (many contacts per company, one Primary) | Contacts stored as a JSON blob on the client row | Normalized contacts, Primary flag |

---

## 3. Column mapping — Sheet → ERP

> The sheet's headers are on row 2 (row 1 is a description). Join key everywhere = **Company Name**.

### `01_Lead_Master` (148 rows) → `crm_leads` (+ `clients2`/`prospects_clients`)
| Sheet column | ERP target field |
|---|---|
| Lead ID (`L-0001`) | `crm_leads.id` (keep sheet id in a `legacy_lead_id`) |
| Company Name | `crm_leads.company_name` **(unique key)** |
| Contact Person | `crm_leads.contact_person` |
| Designation | contacts directory role |
| Phone / Email | `crm_leads.phone` / `email` |
| City | `clients2.City` |
| Industry | `crm_leads` industry (ref list) |
| Source | `crm_leads.source` |
| Assigned To | `crm_leads.assigned_to` (→ users) |
| Status (New/Contacted/Qualified/Quotation Sent/Won/Lost) | `crm_leads.status` |
| Lead Date | `crm_leads.created_at` |
| Last Contact (auto) | **derived** from activities |
| Notes / Requirement | `crm_leads` notes |

### `02_Customer_Master` (98) → `clients2`
Customer ID→`ClientCode` · Customer Name→`ClientName` · Segment(A/B/C)→`Rating`/segment · Products Bought→`Products` · Monthly Value→`TotalValue` · Last Order Date(auto) · Key Contact(auto)→contacts · Payment Terms→`PaymentTerms` · Risk Level→`Rating`/risk · Owner(auto) · Notes→`Notes`.

### `03_Activity_Tracker` (74) → `crm_activity_timeline`
Act ID · Date→`activity_at` · Company→`lead_id` (resolve by name) · Contact Person · Activity Type(Call/Email/Meeting…)→`activity_type` · Discussion Summary→`action_text` · Outcome · Done By→`actor_user_id`.

### `04_Next_Action` (298) → CRM tasks / follow-ups
Action ID · Company · Last Interaction(auto) · Next Action→title · Due Date · Priority · Owner · Status · Days Left(auto = Due − today) · Remarks.

### `05_Opportunity_Pipeline` (298) → `crm` opportunities / deals
Opp ID · Company · Product · Estimated Value · Probability % · Stage · Expected Closing Date · Owner(auto) · Blocker/Next Step · Weighted Value(auto = value × prob).

### `13_Contacts_Directory` → new normalized contacts
Contact ID · Company · Full Name · Role/Designation · Department · Phone · Email · Primary? · Notes.

### `14_Payments_Tracker` (~298) → `client_payments_data`
Invoice # · Customer · Invoice Date · Invoice Amount · Payment Terms(auto) · Due Date(auto) · Amount Received · Balance(auto) · Days Past Due(auto) · Status(auto) · PO/Remarks.

### `10_Lost_Lead_Analysis` → new lost-lead table
Lead ID(auto) · Company · Product(auto) · Lost Date(auto) · Value Lost(auto) · Reason Code · Competitor Won · Learnings.

### `12_Reference_Lists` → new `crm_reference_lists`
Salesperson · Lead Status · Pipeline Stage · Activity Type · Priority · Industry · Lead Source · Product Category.

---

## 4. The data-mismatch problem

The ERP's `clients2` / `prospects_clients` don't contain these 148 leads / 98 customers — the **sheet is the source of truth** for the active book of business. So integration = a **one-time import + an ongoing upload path**:

1. **Importer** (reuse the Production-Log pattern): upload the `.xlsx`, parse each sheet, map columns above, **upsert by Company Name** (create `crm_leads`, promote Won → `clients2`, attach activities/pipeline/payments/contacts).
2. **Dedupe** against existing ERP clients by normalized company name (case/space-insensitive) — report matches vs. new before writing.
3. Going forward, keep one path: enter in the ERP, or re-upload the sheet (importer upserts, never duplicates).

---

## 5. Recommended upgrade plan (phased)

**Phase 1 — Foundations (schema):** add UNIQUE normalized-company key + dedupe to the account registry; make `crm_leads` the single Lead Master; add `crm_reference_lists`, `crm_contacts`, `crm_lost_leads`; add `next_action`/follow-up fields. Wire the *existing* normalized `crm_*` tables to the UI (today the UI uses legacy sheet tables; the good normalized tables sit unused).

**Phase 2 — Import the sheet** (the data you actually care about): the `.xlsx` importer with column-mapping + dedupe preview + upsert-by-company.

**Phase 3 — The behaviors that make it a CRM:** auto-calculated fields (Last Contact, Days Left, Weighted Value, Last Order Date) as DB views/RPCs; **Today's Follow-ups** screen; **AR aging** dashboard; Lost-Lead capture; weekly/monthly review.

**Phase 4 — Consolidate the UI:** replace the 9-dialog `CRMManagement` with a **Customer 360** (one company → tabs: profile, contacts, activities, pipeline, payments, tasks) so "enter once, see everything" holds. The Sales dashboard from the redesign blueprint plugs in here.

**Quick wins (low effort, high value):** Today's Follow-ups view · AR aging on existing `client_payments_data` · the `.xlsx` importer (gets your real data in immediately).

---

## 6. Next step
The fastest way to make this real and visible: build the **`.xlsx` CRM importer** first (Phase 2) — it pulls your 148 leads / 98 customers / pipeline / payments into the ERP so you're working off real data, then we layer the behaviors (Phase 3) on top. This mirrors the Production-Log module we already built.

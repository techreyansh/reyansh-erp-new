# CRM Company 360° Redesign — Plan (parked, ready to build)

**Date:** 2026-06-25 · **Status:** planned, not started. User requested (with the "Edit company" screenshot); parked behind the deploy/QA track.
**Goal:** Turn the Prospects + Clients Company page into a complete 360° CRM record — eliminate storing contacts outside the ERP.

## Headline: the data model already exists
Every child table the redesign needs is **already in prod** (`supabase/migrations/20260620380000_crm_accounts_unify_b1.sql` + `20260619160000_crm_pipeline.sql`). This is **~80% UI wiring**, not a new schema.

| Need | Table (exists) | Notes |
|---|---|---|
| Company master | `crm_pipeline` (41 cols) | add ~18 cols (below) |
| Multiple contacts | `crm_account_contacts` | full_name, designation, department, phone, email, is_primary, notes — **needs: alt_phone, linkedin, birthday, is_decision_maker, preferred_comm** |
| Multiple addresses | `crm_account_addresses` | type(billing/shipping), line1/2, city, state, pincode, country, gstin, is_default — **needs: more types (registered/corporate/factory/warehouse), maps_url** |
| Documents | `crm_account_documents` (stub) | doc_type, file_name, storage_path — **needs: a Supabase Storage bucket + upload flow** |
| Timeline | `crm_pipeline_activity` (rich) | types call/email/meeting/note/sample/quotation/whatsapp + outcome/status + `crm_activity_audit` |

**Components to redesign:** `src/components/crm/Client360.js` (clients, tabbed — Contacts tab exists but unrendered) AND `src/pages/crm/CRMPipelineBoard.js` (prospect `CompanyDrawer` + `EditCompanyDialog` ~L2531 + `ContactDialog` ~L2428). **Recommendation: build ONE shared Company360 component both use** (avoid duplicating the redesign twice).
**Service:** `crmPipelineService.js` already has contacts CRUD (listContacts/addContact/updateContact/deleteContact), listAddresses, activities CRUD, clientTimeline. Mostly add address CRUD + document upload + the new columns.

## Phased build
- **P0 schema** — one migration: add to `crm_pipeline`: legal_name, customer_type, cin, iec, annual_turnover, employees, description, products_manufactured, markets_served, existing_suppliers, territory, currency, preferred_comm, tags(jsonb/text[]), current_products, interested_products, monthly_consumption, competitors, last_meeting_date. Add to `crm_account_contacts`: alt_phone, linkedin, birthday, is_decision_maker, preferred_comm. Add to `crm_account_addresses`: relax type CHECK to registered/corporate/factory/warehouse/billing/shipping, add maps_url. Backfill nothing.
- **P1 — shared Company360 component + expanded company fields** in tabbed/collapsible layout (Company Info · Contacts · Addresses · Business · Documents · Timeline). Replace EditCompanyDialog's flat sections; mobile-friendly.
- **P2 — multi-contact** table/card UI (add unlimited; view/edit/delete/mark-primary/call/email/WhatsApp). Wire the empty Client360 Contacts tab.
- **P3 — addresses** (multiple, typed, set-default, maps link).
- **P4 — documents** (Storage bucket `crm-documents` + path `accounts/{id}/{file}` + RLS; upload/download/delete; GST/PAN/PO/agreements/NDA/drawings categories).
- **P5 — timeline** polish (filter/search; show status/outcome; the unified clientTimeline already merges activities/orders/invoices/dispatch/complaints).

**UI requirements:** tabs/collapsible to avoid clutter; mobile-friendly; searchable/filterable fields; scale to enterprise (multi-plant, dozens of contacts) — the child-table model already supports this.

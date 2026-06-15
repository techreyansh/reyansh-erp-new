# Reyansh ERP — Task Backlog

How we use this file:
1. **You** add / reorder tasks under "Queue" (top = done first). Edit freely.
2. **Claude** reads this, fills in a short plan + any inputs it needs per task, and flags blockers.
3. When you say **"run the queue"** (or "go"), Claude executes the tasks **in order, autonomously** — committing after each one — and only pauses if a task is genuinely **blocked** on an input from you (a file, a credential, a decision). Everything else runs without intervention.
4. Completed tasks move to "Done".

Status legend: `[ ]` to do · `[~]` in progress · `[x]` done · `[!]` blocked (needs your input)

How to write a task (so it can run unattended): one line goal + (optional) details + "Needs:" if it requires something from you.

---

## Queue (in priority order — edit me)

> Add your tasks here. The ones below are the open items from our sessions — reorder, delete, or add to them.

1. [ ] **Deploy the Production Log AI** — apply migration + deploy the `extract-production-log` Edge Function + set the key.
   - Needs: `GEMINI_API_KEY` (from aistudio.google.com), and Supabase Dashboard access (already used). Mostly your action; Claude can prep everything.

2. [ ] **BOM — cable + molding (two-level, product-wise)** — cable sub-assembly BOM → becomes a raw-material line in the finished power-cord BOM; raw materials from Inventory, finished product to FG store. Match the existing Inventory BOM format.
   - Needs: a quick walkthrough / example of how one power cord breaks down (cable + plug + terminals + other material).

3. [ ] **BOM-based costing** — second costing mode that auto-pulls each material's rate from the BOM (alongside the manual costing already built).
   - Needs: the actual Costing `.xlsx` to lock the PVC weight formula exactly. Depends on task 2.

4. [ ] **CRM phase-3** — import Activities / Pipeline / Payments from the CRM tracker; add a "Today's Follow-ups" daily-driver view and an AR-aging dashboard. (See `CRM_INTEGRATION_ANALYSIS.md`.)

5. [ ] **Costing suite** (goal: beautiful, customer-facing + internal)
   - [x] Live cost-breakdown preview in the entry form.
   - [!] Verify formulas against the real Excel (esp. PVC weight). **Needs: the Costing `.xlsx`.**
   - [!] Bottom-up (BOM-based) costing mode — auto-pull rates from the BOM. **Needs: BOM (task 2).**
   - [ ] Connect a saved costing → CRM quotation (and a printable, customer-ready quote view).

6. [x] **AI Purchase-Order ingestion** — BUILT. Upload card on `/po-ingestion` → Edge Function `extract-purchase-order` (Gemini) → preview header + line items → "Apply" pre-fills the Sales Order form with real qty/price/desc.
   - **Runtime needs (to function):** `supabase functions deploy extract-purchase-order` + `GEMINI_API_KEY` (same secret as Production Log).

7. [x] **Sensible default ordering everywhere (no data change)** — DONE. Clients/Prospects already open A–Z; the shared `ModuleTablePage` (CRM leads/customers/quotations/orders/collections) already sorts by first column + has click-to-sort headers; added newest-first defaults to leads/quotations/orders/collections and to the Costing entries table. No stored data was changed.

8. [ ] _(your next task…)_

---

## Done (recent)

- [x] Brand kit applied across the ERP (sky-blue palette + Montserrat/Inter), 74 files.
- [x] Homepage rebuilt as a live command center (KPIs + charts).
- [x] CRM flow strip + onboarding Playbook (`/crm/guide`) + enterprise-panel/timeline polish.
- [x] CRM importer (`/crm-import`) — leads → prospects, customers → clients.
- [x] Costing screen restyled onto the design kit.
- [x] CEO Command Center, Plant Head dashboard, shared dashboard kit.
- [x] Production Log AI module (upload Excel/CSV/photos → Claude extract/analyze).
- [x] Navigation restructured into collapsible, outcome-based sections.

---

## Notes / decisions
- All work lands on branch `feature/erp-redesign-and-production-log` → PR #1.
- Claude commits after each task with a clear message; pushes when you ask or at the end of a queue run.
- If a task is blocked on an input, Claude marks it `[!]`, skips ahead to the next runnable task, and lists what it needs.

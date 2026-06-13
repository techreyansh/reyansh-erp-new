# Reyansh ERP — UX Redesign Blueprint

**From "a system where people enter data" → "a system that helps people make decisions."**

Author: CPO / Head of UX engagement · Date: 2026-06-13
Grounded in a full audit of the actual codebase (~80 routes, ~207 components, 14+ roles), not a hypothetical ERP.

Every screen must answer three questions: **What happened? · What is happening? · What should I do next?**

---

## 0. Executive summary — the 5 things that matter

1. **The core disease is data re-entry, not missing features.** Customer data is re-typed across ~8 forms, product code ~7, supplier ~4. Sales flow = 11 steps, Purchase flow = 21 steps — **none inherit data from the prior step.** Fixing inheritance is the single highest-ROI change in the system.
2. **Dashboards show data, not decisions.** The mature Executive dashboard has 8 KPIs and 9 charts but no "what needs attention now" layer. We've now shipped that pattern as the flagship `/ceo-command` Command Center. It must propagate to every role.
3. **Quality is a hole, not a module.** `QualityCheck.js` and `InspectSample.js` are mock/TODO. There is no NCR, no rejection trend, no QC dashboard — yet KPIs already reference "rejection rate." This is the biggest functional gap.
4. **Navigation is wide and flat-ish but mislabeled.** 6 groups, 35+ items, with overlapping concepts ("Management" holds tasks AND inventory AND dispatch; "Workflows" duplicates production already in "PPC"). Role-based menus exist — they should be ruthlessly pruned per role.
5. **Schema fragmentation is a tax on everything.** 12+ field-name variants for "supplier", multiple spellings of product spec fields. Every form pays for this with defensive `||` chains. A master-data cleanup unlocks automation everywhere.

---

## STEP 1 — ERP Audit (module × issue × impact × fix)

| Module | Current Issue | Impact | Recommended Improvement |
|---|---|---|---|
| **Navigation / IA** | 6 groups, 35+ items; "Management" is a junk drawer (inventory + tasks + dispatch + docs); "Workflows" duplicates "PPC" production | Users hunt; new hires can't build a mental model | Re-group into 7 outcome-based areas (below); kill duplicate entries; role-prune aggressively |
| **CEO / Executive** | `/ceo-command` was an empty "Coming Soon"; `/dashboard` shows data but no action layer | Leaders read charts, can't act | ✅ **Shipped:** Attention-First Command Center with ranked alerts + one-click actions |
| **Sales Flow** | 11-step linear wizard; each step starts empty; customer/products re-entered 3–5× | ~65 fields/lead; slow; error-prone | Carry context across steps; pre-fill from CRM; collapse to ~5 meaningful stages |
| **Purchase Flow** | 21 steps; PO/supplier re-entered up to 5×; QC steps are mock code | ~80 fields/indent; longest flow; broken QC | Data inheritance; auto-route rejections; complete or replace QC steps |
| **Production (cable/molding/ppc)** | 3-tier master→plan→execution with **zero inheritance**; operator re-enters everything per shift | Floor-level friction; bad data quality | Pre-fill shift sheets from plan; mobile shift entry; real "today's plan" board |
| **Inventory** | Item code re-entered master→inward→issue (3×); supplier is free text | Duplicate masters; stock drift | Autocomplete from master; auto stock-deduction on approved GRN |
| **Dispatch** | No auto-suggest of ready-to-ship batches; client re-entered | Manual matching; delays | "Ready to dispatch" queue fed from FG + orders; barcode/mobile confirm |
| **Quality** | **Module effectively absent** (mock/TODO) | No NCR, no rejection trend, no traceability | Build QC module: inspection → NCR → CAPA → dashboard |
| **CRM** | 9 separate entity dialogs; 12 pagination states; no duplicate detection | Fragmented; clientCode re-typed 8× | Unified Customer 360 with tabbed timeline; dedupe on lead creation |
| **Tasks** | No templates, no subtasks; dept assignment with no preview | Repetitive setup; blind bulk-assign | Templates, subtasks, assignment preview |
| **Search** | `Cmd+K` exists but only routes menu items | Underused power feature | Upgrade to universal command bar (records + actions + nav) |
| **Mobile** | Responsive drawer exists; forms not mobile-optimized | Field/sales/floor users struggle | Mobile-first flows for approvals, follow-ups, production updates |

---

## STEP 2 — Role-based thinking

For each role: **need most often · show immediately · one-click action · hidden-but-important.**

| Role | Needs most often | Show immediately | One-click action | Hidden but important |
|---|---|---|---|---|
| **CEO** | "Is anything on fire?" | Revenue MTD, outstanding, delayed orders, concentration risk | Drill into any alert | Customer concentration; cash runway |
| **Plant Head** | Output vs target, downtime | Production vs target, OEE, rejection %, dispatch readiness | Reassign a line / escalate | Repeated micro-stops; shift variance |
| **Production Planner** | Today's plan & loading | Running/pending jobs, machine load, delays | Re-sequence a job | Capacity bottleneck next 48h |
| **Quality Mgr** | Open NCRs, rejection trend | NCRs by age, rejection by line/product, complaints | Raise/close NCR | Recurring defect = systemic cause |
| **Store Mgr** | Stock vs reorder | Items below reorder, pending GRNs, ready-to-issue | Issue/receive material | Slow-moving / dead stock |
| **Sales** | Follow-ups due today | Pipeline, follow-ups due, quotes pending, aging leads | Log a call / send quote | Customers gone quiet (inactivity) |
| **CRM** | Collections & accounts | Outstanding by customer, reminders due | Record payment / reminder | At-risk accounts |
| **Accounts** | AR/AP, payments due | Outstanding, payments to release, invoices | Approve/release payment | Overdue receivables aging |
| **Machine Operator** | What to run now | Current job, target, reject count | Update output / flag issue | Maintenance due |

**Design rule:** each role lands on a dashboard built from *its* table above — not a shared generic page.

---

## STEP 3 — Information Architecture redesign

**Current (6 groups, overlapping):** Dashboard · Management (junk drawer) · CRM · PPC · Workflows (dup) · System.

**Proposed (7 outcome-based areas, role-pruned):**

```
🏠  Home            → role-specific Command Center (the only default landing)
💰  Sales & CRM     → Pipeline · Customers · Quotations · Orders · Collections · Follow-ups
🏭  Production       → Plan Board · Jobs · Machines/OEE · Cable · Molding
📦  Inventory        → Stock · Material In/Out · Finished Goods · Kitting · BOM
🚚  Dispatch         → Ready-to-Ship Queue · Shipments · Delivery
🛡️  Quality          → Inspections · NCRs · Rejections · Complaints   (NEW)
🛒  Procurement      → Indents · RFQ · POs · Vendors · GRN
⚙️  Admin            → Employees · Access · Tasks · Documents · Settings
```

Principles: (1) **one default landing per role**; (2) **kill duplicate routes** (Workflows production ≈ PPC production); (3) **flatten** — every screen ≤ 2 clicks from Home; (4) **verbs in the command bar**, nouns in the nav.

---

## STEP 4 — Dashboard redesign (the core doctrine)

**Every dashboard leads with an "Attention Rail": ranked cards of risks/bottlenecks/opportunities, each with a one-click action.** Data/charts come *after* the decisions. This is now implemented in `/ceo-command` and is the template for all of the below.

- **CEO** (✅ shipped): attention rail · revenue MTD/order book/collected/outstanding/pending dispatch/leads · revenue trend · dispatch readiness · top customers · concentration risk · department snapshot.
- **Plant Head**: production vs target · line efficiency · rejection % · downtime · capacity utilization · workforce productivity · quality alerts · dispatch readiness.
- **Sales**: pipeline value · follow-ups due today · quotations pending · leads aging · conversion rate · salesperson leaderboard · customer inactivity alerts.
- **Production**: today's plan · running jobs · pending jobs · delays · machine loading · shift performance.
- **Quality**: open NCRs · rejection trends · customer complaints · quality risk areas.

---

## STEP 5 — Data-visualization transformation

Replace tables with the fastest-to-read form:

| Instead of a table of… | Use |
|---|---|
| Orders by status | **Funnel** (Quoted → Ordered → Collected) |
| Machine load | **Capacity heatmap** (machine × shift) |
| Production vs target | **Progress bars / bullet charts** |
| Jobs by stage | **Kanban board** |
| Dispatch pipeline | **Timeline** + readiness donut |
| Receivables | **AR aging bars** (0–30/30–60/60–90/90+) |
| Rejections over time | **Trend line + Pareto** (80/20 defect causes) |
| Sales pipeline | **Funnel + leaderboard** |

Library: **Recharts** is already standard — keep it; standardize the palette (already defined: `CHART_COLORS`). Add a shared `<Panel>` + `<StatCard>` + `<AttentionCard>` kit (the flagship introduces these — extract to `src/components/common/` next).

---

## STEP 6 — Smart Insight Engine

The flagship ships a first version: `deriveAttention()` in `CEOExecutiveDashboard.js` converts raw summary data into ranked, actionable alerts (outstanding AR, pending dispatch, concentration risk, overdue/blocked tasks, open quotes, active leads).

Extend it into a reusable `insightEngine` service producing typed insights:
- `"Order #245 may slip 3 days — PVC stock below kit requirement."` (needs BOM × stock join)
- `"Customer XYZ purchasing down 37% vs 90-day avg."` (needs order history by customer)
- `"Machine M3 idle 4.2h this shift."` (from OEE/monitoring)
- `"₹4.2L receivable from ABC is 90+ days overdue."`

Each insight = `{ severity, title, detail, cta, path, entity }` so any dashboard can render it via `<AttentionCard>`.

---

## STEP 7 — Workflow optimization (reduce entry, increase automation)

| Pattern | Apply to | Mechanism |
|---|---|---|
| **Context inheritance** | Sales (11), Purchase (21), Production (3-tier) | A flow-level context/store pre-fills each step from the previous; never re-type customer/product/supplier |
| **Master autocomplete** | All forms | Type-ahead from Customer/Product/Vendor master; block free-text that creates dupes |
| **Smart defaults** | Quotation, opportunity, production plan | Pre-fill price from product master; probability from stage; output estimate from history |
| **Auto-routing** | Purchase rejection (steps 14–16) | Rejected material auto-creates return + resend, no re-entry |
| **Stock automation** | Inventory | Approved GRN auto-increments stock; issue auto-decrements |
| **Bulk actions** | Indents, quotes, dispatch, imports | Multi-select approve / assign / import |

---

## STEP 8 — Design system

- **Typography**: keep MUI; tighten scale — H4/800 for page titles (letter-spacing −0.03em), Subtitle/700 for panels, Caption/700 uppercase for labels (already used in the flagship). Highly readable, dense-but-calm.
- **Spacing**: 8px base; cards `borderRadius: 2.5`, `p: 2`; consistent `spacing={2}` grids.
- **Color**: keep the teal-led palette (`#0D9488` primary). Semantic: success `#059669`, warning `#D97706`, critical `#DC2626`, info `#0284C7`. Manufacturing-friendly, high-contrast, color-blind-safe pairings.
- **Components to standardize** (extract from flagship): `StatCard`, `Panel`, `AttentionCard`, `GridBox`, status `Chip` colors. Put in `src/components/common/kit/`.

---

## STEP 9 — Premium enterprise feel (Linear/Stripe/Fiori)

Land the feel via: generous whitespace, one accent color, outlined cards over heavy shadows, micro-interactions (hover lift, 60s live refresh with a pulse dot — both in the flagship), skeletons not spinners, empty-states that teach. Avoid: tiny fonts, dense tables as the default, modal-in-modal, rainbow charts.

---

## STEP 10 — Mobile experience (mobile-first for field roles)

Priority flows: **Sales follow-ups · Approvals (quote/PO/payment) · Production shift updates · Collections reminders.** Pattern: bottom-tab shell, single-column cards, thumb-reachable primary action, offline-tolerant entry for the floor. The flagship is already responsive (xl container, 6→2 col KPI reflow); extend the kit to be mobile-first.

---

## STEP 11 — Module-wise improvement plan (condensed)

> Format per module: *Issues → UX fix → Layout → Dashboard → Automation.* Full detail expands on Step 1 + Step 2.

- **Sales/CRM** — Issues: 9 dialogs, re-entry, no dedupe. Fix: Customer 360 with tabbed timeline. Dashboard: Sales attention rail + leaderboard + inactivity alerts. Automation: dedupe, stage→probability defaults, follow-up reminders.
- **Production** — Issues: no inheritance, no live plan board. Fix: Kanban "today's plan" + machine capacity heatmap. Dashboard: Plant Head (target/OEE/rejection/downtime). Automation: shift sheet pre-fill from plan.
- **Inventory** — Issues: 3× code entry, free-text supplier. Fix: master autocomplete. Dashboard: below-reorder + dead stock. Automation: GRN→stock posting.
- **Dispatch** — Issues: manual batch match. Fix: Ready-to-Ship queue. Dashboard: readiness donut + delivery timeline. Automation: auto-suggest shippable orders; mobile POD.
- **Quality (NEW)** — Build: inspection form → NCR → CAPA. Dashboard: open NCRs by age, rejection Pareto, complaints. Automation: auto-NCR on failed inspection, link to lot/batch.
- **Procurement** — Issues: 21 steps, 5× re-entry, mock QC. Fix: collapse + inherit. Dashboard: PO aging, vendor reliability. Automation: rejection auto-routing.

---

## STEP 12 — Advanced features

- **Universal command bar** (upgrade existing `Cmd+K`): jump to any record, run actions ("create quote", "log call"), not just nav.
- **AI insights / predictive alerts**: delay prediction (BOM × stock × lead time), churn signal (order cadence drop), demand forecast.
- **Saved views & personal dashboards**: per-user pinned filters and KPI layout.
- **Quick actions**: contextual `+` on every list.

---

## STEP 13 — Implementation priority

**HIGH impact / LOW effort** (do first)
- ✅ Attention-First Command Center (done — replicate pattern per role)
- Role-pruned navigation + kill duplicate routes
- Master autocomplete on the 3 worst forms (inward, PO, lead)
- Standardize the component kit (`StatCard`/`Panel`/`AttentionCard`)
- AR aging + customer-inactivity insights

**HIGH impact / HIGH effort**
- Context inheritance across Sales & Purchase flows
- Build the Quality module (inspection → NCR → CAPA → dashboard)
- Production plan board + capacity heatmap + Plant Head dashboard
- Stock automation (GRN→stock, issue→stock)
- Master-data cleanup / schema unification

**LOW impact / LOW effort**
- Empty-state polish, skeletons, chart palette consistency
- Remove leftover `temp_ours.js` / `temp_theirs.js`, dead demo routes

**LOW impact / HIGH effort** (defer)
- Real-time IoT machine integration (beyond current simulation)
- Full offline mobile sync

---

## STEP 14 — Code implementation (this engagement)

**Shipped now:**
- `src/components/ceoDashboard/CEOExecutiveDashboard.js` — full Attention-First Command Center (attention engine + KPI strip + revenue/dispatch/customer panels + department snapshot). Replaces the old placeholder at `/ceo-command`.
- `src/services/executiveDashboardService.js` — additive: `topCustomers`, `concentration` (top-1 / top-3 revenue share), `taskRisk` (overdue/blocked). Non-breaking for the existing `/dashboard`.

**Recommended next code steps (in order):**
1. Extract `StatCard` / `Panel` / `AttentionCard` → `src/components/common/kit/` and refactor `/dashboard` to use them.
2. Build `src/services/insightEngine.js` (generalize `deriveAttention`) + per-role dashboards (Plant Head, Sales, Production, Quality) reusing the kit.
3. Add a `FlowContext` provider to carry data across Sales/Purchase steps (kills the re-entry tax).
4. Scaffold the Quality module (`src/components/quality/`): Inspection, NCR, CAPA, QualityDashboard.

Stack: keep React 18 + MUI v7 + Recharts (no new heavy deps needed). Consider `@tanstack/react-query` later for cache/refetch hygiene.

---

## Final goal restated

Every screen, every role, answers: **What happened? What is happening? What should I do next?** The flagship Command Center is the proof of the pattern — the rest of this blueprint is propagating it across the ERP while removing the data-entry tax underneath.

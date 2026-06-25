# Factory Operations App — Architecture

**Date:** 2026-06-25 · **Status:** architecture for review (no code yet)
**Thesis:** The ERP is the brain (rules, planning, costing, MRP, masters, reports). The mobile
app is a **thin Factory Operations client** — it *captures* and *displays* operational data and
*syncs* to the ERP. It never duplicates ERP logic. One app, role-filtered modules, every screen
finishable in **under 30 seconds**.

---

## 0. The one rule that governs everything

> **If an action takes more than 30 seconds, or needs typing paragraphs / editing masters /
> analyzing reports / planning, it belongs on the ERP — not the app.**

The phone is for: **Scan · Tap · Select · Confirm · Submit.** Every screen is judged against
the 30-second test. This rule is the design gate for accepting any new screen.

---

## 1. Overall architecture

```
                          ┌─────────────────────────────────────┐
                          │              ERP (BRAIN)             │
                          │  business rules · planning · MRP ·   │
                          │  costing · masters · reports · RBAC  │
                          └───────────────┬─────────────────────┘
                                          │  Postgres + RLS + SECURITY DEFINER RPCs
                          ┌───────────────┴─────────────────────┐
                          │        API LAYER (Supabase)          │
                          │  PostgREST reads · RPC writes · Auth │
                          │  (the ONLY contract the app touches) │
                          └───────────────┬─────────────────────┘
              ┌───────────────────────────┴───────────────────────────┐
              │                                                        │
    ┌─────────┴──────────┐                                  ┌──────────┴─────────┐
    │  FACTORY OPS APP    │                                  │      WEB ERP       │
    │  (thin PWA client)  │                                  │   (management)     │
    │  capture · display  │                                  │  plan · cost · MRP │
    │  scan · photo · sync │                                  │  masters · reports │
    └─────────┬──────────┘                                  └──────────┬─────────┘
              │                                                        │
   Operators · Store · QC · Maintenance · Supervisors        Management · Planning ·
   (data capture, on the floor)                              Purchase · Sales · Accounts
```

**Hard boundary:** the app only **reads** (PostgREST `select` / read RPCs) and **submits**
(write RPCs). All calculations — valuation, capacity, MRP, line-balancing, costing — stay in
ERP RPCs. The app sends *intents* ("operator produced 95 good, 3 reject on stage X"); the ERP
computes consequences (ledger postings, OEE, WIP). This is already how the ERP works today
(`inv_*`, `ppc_post_jobcard`, `mes_*` are all SECURITY DEFINER RPCs) — the app just calls them.

---

## 2. Tech-stack decision (the fork to confirm)

| Option | Fit | Verdict |
|---|---|---|
| **A. PWA — dedicated mobile shell in the existing React app** (code-split `/app` route group, installable, IndexedDB offline, camera scan via `BarcodeDetector`/`@zxing`, photo via `<input capture>`) | Reuses the entire existing Supabase auth + RBAC + RPC layer; one codebase; ships fastest; meets offline + scan + photo. iOS PWA push is limited (use in-app + email for now). | **Recommended for v1** |
| B. Separate React Native / Expo app | Best native camera/scanner/offline + app-store presence; but a second codebase, duplicate auth/RBAC client, app-store release cycle. | Defer — revisit only if PWA hits a hard native limit |

**DECISION (locked, 2026-06-25): Option A — PWA in the existing app.** A solo-built shop on
CRA+Supabase gets every required capability from a PWA without a second stack. The architecture below is structured so the mobile shell
*could* be extracted into a standalone Vite PWA later (own bundle, faster phone load) without
rewriting modules — see §3.

---

## 3. Folder structure (module-registry driven)

```
src/mobile/                         # the Factory Ops App (code-split; extractable later)
  index.jsx                         # mobile entry: <MobileApp/> mounted at /app/*
  shell/
    MobileApp.jsx                   # auth gate → role-filtered home → module router
    AppShell.jsx                    # frame: top bar (online/sync badge), bottom nav, back
    Home.jsx                        # role-filtered module tile grid + My Tasks summary
    ModuleRouter.jsx                # renders the active module's screens from the registry
  core/
    moduleRegistry.js               # THE registry: every module declares itself here
    useMobileAccess.js              # wraps get_my_rbac_access → which modules + actions show
    capabilities.js                 # action-level capability map (per module)
    sync/
      outbox.js                     # write-intent queue (IndexedDB) + flush + status
      cache.js                      # read cache (assigned jobs, WOs, masters)
      useSync.js                    # online/offline + pending-count + manual "sync now"
    api/
      client.js                     # supabase wrapper: read(), rpc(), submit(intent)
      idempotency.js                # client-generated keys for safe retry
  components/                       # the touch primitives every module reuses
    NumPad.jsx  ScanButton.jsx  PhotoCapture.jsx  PickerSheet.jsx
    SubmitBar.jsx  RecentFeed.jsx  Stepper.jsx  Toggle.jsx  OfflineBadge.jsx
  modules/
    store/        { module.js, screens/Issue.jsx, Receipt.jsx, Adjust.jsx, Transfer.jsx, Scan.jsx, service.js }
    production/   { module.js, screens/StartJob, PauseJob, CompleteJob, Reject, Downtime, MaterialRequest, service.js }
    quality/      { module.js, screens/Incoming, Patrol, Final, NCR, Photos, service.js }
    maintenance/  { module.js, screens/PMChecklist, Breakdown, MachineStatus, SpareRequest, service.js }
    dispatch/     { module.js, screens/..., service.js }
    approvals/    { module.js, screens/Inbox, Detail, service.js }
    tasks/        { module.js, screens/MyTasks, service.js }
    hr/  notifications/  dashboard/    # same shape
```

**Module contract** (`module.js`) — adding a module is dropping a folder + this object; no shell
or nav change:
```js
export default {
  key: 'store',                       // maps to an ERP RBAC module_key
  title: 'Store', icon: 'Inventory2',
  requiredModule: 'inventory',        // get_my_rbac_access module gate
  screens: [ { key:'issue', title:'Material Issue', cap:'store.issue', component: Issue }, ... ],
  offlineEntities: ['inv_balance','ppc_items','open_wos'],   // what to cache for offline
};
```

---

## 4. Navigation structure

```
Login (Google OAuth, existing)
   → Splash (load get_my_rbac_access + warm offline cache)
      → HOME  (tile grid of ONLY the modules the role allows + a "My Tasks" badge)
          → MODULE  (its action screens as large tiles or a short bottom-nav)
              → ACTION SCREEN  (fetch → pick/scan → numeric/toggle → Confirm → Submit)
                  → success toast + "recent" feed; back to module
```
- **Bottom nav** (max 5): Home · My Tasks · Scan (global quick-scan) · Approvals · Notifications.
  Modules live behind Home tiles; the bottom nav is the always-there spine.
- Deep links: `/app/store/issue`, `/app/production/complete?wo=…` (for QR jump-to-action).
- Nav is generated from the registry filtered by access — never hand-maintained.

---

## 5. Role-based permission model (reuse the ERP, add an action layer)

Two layers, both server-authoritative:

1. **Module visibility** — the existing `get_my_rbac_access()` already returns the user's
   modules with `can_view/create/edit/delete`. A module tile shows iff `can_view` on its
   `requiredModule`. (We just proved this layer end-to-end with `PROCESS_COORDINATOR_SCOPED`.)
2. **Action capability** — finer than module. e.g. a Production *Operator* can Start/Complete a
   job but not Approve. Model as a **capability set per role**, stored in a new additive table
   `mobile_role_capabilities(role_code, capability)` (e.g. `production.complete`,
   `quality.ncr.create`, `store.adjust`). The app reads the caller's capabilities once at login
   (a `get_my_capabilities()` RPC) and gates screens/buttons. RLS + the SECURITY DEFINER RPCs
   remain the real enforcement — the app gate is UX, the DB is the wall.

**Persona → modules (initial):**
| Role | Modules | Sample capabilities |
|---|---|---|
| Store Keeper | Store, Tasks | store.issue, store.receipt, store.adjust, store.transfer, store.scan |
| Production Operator | Production, Tasks | prod.start, prod.pause, prod.complete, prod.reject, prod.downtime, prod.material_request |
| Quality Inspector | Quality, Tasks | qa.incoming, qa.patrol, qa.final, qa.ncr, qa.photo |
| Maintenance | Maintenance, Tasks | mtc.pm, mtc.breakdown, mtc.status, mtc.spare_request |
| Supervisor | Dashboard, Approvals, Production, Tasks | sup.approve, sup.escalate, view team |

Critically: this is **additive** (the ERP RBAC lesson from this session) — to *restrict* a user
you assign a narrow role, you don't subtract per-employee. Personas above = roles, each granted
exactly its modules + capabilities.

---

## 6. API interaction strategy

- **Reads:** PostgREST `select` for lists (assigned jobs, open WOs, pending inspections,
  masters) + read RPCs for computed views (`ppc_reorder_board`, dashboards). Cached (§7).
- **Writes:** ONLY through existing SECURITY DEFINER RPCs — `inv_receive/issue/adjust/transfer`,
  `ppc_post_jobcard`, `ppc_issue_kit*`, QC posts, maintenance posts. The app never writes
  business tables directly; the RPC computes the consequence.
- **No business logic client-side.** The app builds an *intent* `{ rpc, args, idempotencyKey }`
  and submits it. Validation beyond "is this a number / is a value picked" lives in the RPC.
- **Idempotency:** every submit carries a client-generated key; write RPCs must be safe to
  replay (the append-only ledger + "already posted" guards already give us this — extend the
  pattern to new RPCs). This is what makes offline retry safe.
- **Typed thin layer** `core/api/client.js`: `read(table, query)`, `rpc(name, args)`,
  `submit(intent)` (→ outbox). One place to add auth headers, retries, and telemetry.

---

## 7. Offline sync strategy (new requirement — factory wifi is unreliable)

**Two stores in IndexedDB (via Dexie):**
- **Read cache** — per the module's `offlineEntities`, warmed at login + refreshed on focus.
  Lets a screen open and let the operator pick items/WOs with no signal.
- **Outbox** — every submit is an intent row `{ id, rpc, args, idempotencyKey, createdAt,
  status: queued|sent|failed, attempts, error }`. Screens write to the outbox and return
  instantly (optimistic). A **flusher** drains it when online (exponential backoff).

```
 submit ──▶ outbox(queued) ──▶ [online?] ──▶ rpc(args, idemKey) ──▶ ok ──▶ outbox(sent, prune)
                  ▲                                   │
                  └────────────── retry ◀── fail ─────┘     (backoff; surfaced in sync badge)
```

- **Conflict handling = server-authoritative + idempotency.** The ERP is the source of truth; an
  intent either applies or is rejected with a reason the operator sees on next sync. Append-only
  ledgers mean two queued issues both post (no lost update); "already done" guards make replays
  no-ops. No client-side merge logic.
- **Sync status** — a persistent badge (✓ synced / ⟳ N pending / ⚠ N failed) + a "Sync now"
  action + a per-submission state on its recent-feed row.
- **Scope guard:** offline covers *capture* (the 30-second actions). It does NOT cache reports or
  let you plan offline — those are ERP-only anyway.

---

## 8. Module architecture (the standard screen)

Every capture screen is the same five-beat shape (the 30-second pattern), so modules are
near-identical to build and learn:

```
 FETCH (cached)  →  PICK / SCAN  →  NUMERIC / TOGGLE  →  CONFIRM  →  SUBMIT(outbox)
   open WOs         QR or list       NumPad / chips      one tap     optimistic + feed
```

A module = a registry entry + screens that compose the shared primitives (`PickerSheet`,
`ScanButton`, `NumPad`, `PhotoCapture`, `SubmitBar`, `RecentFeed`) and call its `service.js`
(thin wrappers over ERP RPCs). No module owns business logic.

---

## 9. Screen-flow diagrams (the launch modules)

**Store** (wraps the live `inv_*` RPCs — the work already scoped in issue #5 becomes this module):
```
Issue:    [open WO ▼ | scan]→ kit lines (req−issued) → qty(NumPad) → Submit → inv_issue_kit_line
          free-form:  scan/pick item → qty → STORE→WIP → Submit → inv_issue
Receipt:  open PO ▼ → line qty + rate → Submit → inv_receive
Adjust:   item+location → counted qty → Submit → inv_adjust
Transfer: item → from→to loc → qty → Submit → inv_transfer
Scan:     QR → resolves item/location → jumps into the right action
```
**Production** (wraps `ppc_post_jobcard` + WO state):
```
Start:    scan WO → confirm op/stage → Start (timestamp)
Pause:    active job → reason chip → Pause
Complete: active job → good qty + reject qty → reject reason chips → photo? → Submit → ppc_post_jobcard
Downtime: machine → reason chip → minutes(NumPad) → Submit
MaterialRequest: WO → item + qty → Submit (raises a request the Store sees)
```
**Quality** (new QC RPCs in the ERP; app captures observations + photos):
```
Incoming/Patrol/Final: pick WO/lot → characteristic chips pass/fail → measured value(NumPad) → photo → Submit
NCR:     subject → defect chips → qty → photo(s) → Submit (raises NCR in ERP)
```
**Maintenance:**
```
PM Checklist: machine → checklist toggles → photo → Submit
Breakdown:    machine → symptom chips → photo → Submit (raises breakdown)
MachineStatus: machine → running/idle/down toggle → Submit
SpareRequest: machine → spare item + qty → Submit
```
**Supervisor:** Team Dashboard (read) · Approvals inbox (approve/reject + reason) · Escalations.

---

## 10. Security
- **Auth:** existing Supabase Google OAuth (JWT). The app holds the session; every API call is
  authenticated; RLS enforces row visibility.
- **Authorization:** module gate (`get_my_rbac_access`) + capability gate (`get_my_capabilities`)
  in the UI; SECURITY DEFINER RPCs + RLS at the DB are the real boundary.
- **Audit:** every write RPC already stamps `posted_by`/`created_by_email` + timestamp — the
  capture trail is intrinsic. Outbox keeps a local history too.
- **Device/session:** standard Supabase session management; add a "this device" session list +
  remote sign-out later if shared devices appear.

---

## 11. Future expansion strategy
New modules (Safety, EHS, Visitor, Tool Room, Calibration, Training, Asset Verification, Fleet)
are added by: (1) ERP adds the capture RPCs + an RBAC `module_key`; (2) drop a `modules/<x>/`
folder with a `module.js` + screens composed from the shared primitives; (3) grant the
capability to the relevant role. **Zero shell/nav/architecture change** — the registry + the
standard screen shape absorb it. The 30-second rule decides what's allowed in.

---

## 12. Build sequencing (proposed)
1. **Platform foundation** — mobile shell, registry, `useMobileAccess`, the touch primitives,
   the api/outbox/cache core, the PWA manifest + service worker, `mobile_role_capabilities` +
   `get_my_capabilities()` RPC. (No business modules yet — prove the frame + offline + a stub.)
2. **Store module** (highest-ready: RPCs all live; folds in the issue-#5 work).
3. **Production module** (job-card capture already exists as `ppc_post_jobcard`).
4. **Quality / Maintenance** (need new ERP capture RPCs first — flag as ERP-side prerequisites).
5. **Approvals / Dashboard / Notifications** as the cross-cutting layer.

Each module is its own spec + build once the foundation lands.
```
```

# Cable Production Module — Implementation Guide & Go‑Live Readiness

_Reyansh International ERP · prepared from an end‑to‑end simulation run against the actual
production engine (`src/services/cablePlanner/*`), plus a code audit of the order‑tracking
and master‑data screens. Numbers below are real engine output, not illustrative._

---

## 1. What was validated (Phases 1–6)

The full planning cycle was exercised with realistic data: 8 cables (1C 0.5/0.75/1.0;
2C 0.75/1.0; 3C 0.75/1.0; 4C 1.0) and 5 sales orders, fed through the real
`requiredStages → computeStagePlan → estimateRM → runAutoSchedule` pipeline (the same
code the UI calls). The 49 engine unit tests pass.

| Area | Result |
|------|--------|
| **Routing** (Phase 3) | 2C/3C/4C match the intended routing exactly. ⚠️ **1 defect** on single‑core — see §5. |
| **Material calc** (Phase 4) | Internally consistent. e.g. SO‑001 `3C×0.75, 10 000 m` → **Cu 209.66 kg · PVC‑ins 124.86 kg · PVC‑sheath 220.92 kg**. SO‑003 `1C×1.0, 15 000 m` → Cu 139.78 / ins 84.44 / **sheath 0** (correct: single core has no sheath material). |
| **Stage cascade** (back‑calc from finished metres) | Correct: SO‑001 bunch‑in **34 240 m** → core 11 185 → laying 10 850 → sheath‑in 10 526 → finished **10 000 m** (scrap/lay‑reduction applied per machine). |
| **Machine planning** (Phase 5) | Per‑core core jobs split by colour; changeovers applied on size/colour change; reverse + forward scheduling work. |
| **Order tracking** (Phase 6) | WO lifecycle `planned → released → in_progress → qc → done` (+`cancelled`) is wired in the DB; per‑stage `pending → running → done`. ⚠️ Some transitions have no UI button — see §5. |

> **Scheduler note (not a bug):** with one machine per stage, all 5 test orders missed
> aggressive 2–7 day due dates — the engine correctly returns them in `missedDue`. This is
> real capacity infeasibility, not a math error. The product gap is that infeasibility is
> only surfaced as a data array, not a clear pre‑release warning (§5).

---

## 2. Phase 7 — Screen review (UX findings)

| Screen | State | Gaps to close before go‑live |
|--------|-------|------------------------------|
| Cable Master | ✅ Cards + live spec preview, full CRUD, history | — |
| Material / Colour / Size Masters | ✅ Config‑driven, CRUD + audit | — |
| Machine Master | ✅ Visual cards (status/util/next‑job) | Ensure a machine exists for the **`cutting`** stage before releasing power cords (routing appends it). |
| Production Planning / Wizard | ✅ 6‑step wizard, MRP + routing preview | Wizard success message should show the **WO number** (`WO‑YYMMDD‑NNN`), not the plan code. |
| Machine Schedule / Gantt | ✅ Drag‑drop reschedule | No link between WO `due_date` and the saved schedule — "planned vs actual" not shown. |
| MRP Dashboard | ✅ Required vs stock | Add an explicit **shortfall/block banner** at release time. |
| Order Tracking | ⚠️ View‑only flow | **No Start/Complete‑stage buttons** (operators must use the legacy shop‑floor page); **no Cancel‑WO button** (status exists in DB, unreachable in UI); **QC state hidden** (bucketed as "in progress"). |

---

## 3. Phase 8 — Implementation guide

### 3a. Master data to enter first (in this order)
1. **Machine Master** — one machine per stage (`bunching`, `core`, `laying`, `sheathing`,
   and `cutting` if you make power cords). Set shift hours, days/week, speed (m/hr),
   changeover (min), scrap %.
2. **Material Master** — Copper Wire Rod, Copper Stranded Conductor, PVC Insulation
   Compound, PVC Sheathing Compound (+ opening stock).
3. **Colour & Size Masters** — your standard core colours and sqmm sizes.
4. **Cable Master** — each finished cable (cores, size, strand count, gauge, insulation &
   sheath thickness, core‑colour set, voltage, coil length). The card shows a live OD/weight
   preview so you can sanity‑check before saving.
5. **Routing / BOM templates & Planning presets** — optional; speed up repeat planning.

### 3b. What can be imported vs entered
- **Import‑friendly** (bulk CSV/sheet): Cable Master, Material Master, opening stock.
- **Enter once, rarely changes**: Machine Master, Colour/Size masters, presets.
- **Always created in‑app** (not imported): Sales orders / production plans, work orders,
  per‑stage production logs.

### 3c. Daily production planning process
1. Store confirms raw‑material stock (Cu, PVC‑ins, PVC‑sheath).
2. Planner opens **Production Planning**, selects pending orders, runs **Auto‑Schedule**
   (priority = due date; reverse mode to hit due dates).
3. Review **MRP** — if short, raise a purchase indent before releasing.
4. **Release** feasible orders to work orders → stages + material kit are created.
5. Operators run each stage; record output/scrap and operator on the shop‑floor screen.
6. Planner reviews the Gantt / capacity board for clashes and reschedules by drag‑drop.

### 3d. Weekly planning process
- Batch next week's due orders (enable batching — groups same‑spec jobs to cut changeovers).
- Review machine utilisation; flag bottleneck stages (bunching/core are typically heaviest).
- Reconcile finished‑goods stock booked vs dispatched; clear completed/cancelled WOs.

### 3e. Role SOPs

**Production Planner** — owns the plan.
- Daily: pull pending orders → auto‑schedule → resolve `missedDue` (split, re‑sequence, or
  flag capacity) → confirm MRP → release.
- Never release an order whose MRP shows a shortfall without a purchase indent raised.

**Production Manager** — owns execution.
- Approves the released schedule; monitors stage progress and scrap %; signs off WO → `done`.
- Reviews utilisation weekly; escalates chronic bottlenecks (add shift/machine).

**Store Department** — owns material truth.
- Maintains accurate raw‑material + FG stock; issues the material kit against each WO;
- Confirms stock before daily release; books FG on WO completion.

**Purchase Department** — owns supply.
- Acts on MRP shortfalls/indents; keeps Cu & PVC above the reorder level the planner needs.

**Quality Department** — owns release‑to‑dispatch.
- Records QC per stage/WO; a WO must reach `qc` (all stages done) and pass before `done`.
- Owns spark‑test / OD / wall‑thickness checks listed on each job card.

---

## 4. Phase 9 — Go‑Live checklist

**Master data**
- [ ] One machine per stage incl. **`cutting`** (if power cords); shift/speed/scrap set.
- [ ] All active cables in Cable Master with correct strand count, ins/sheath thickness.
- [ ] Raw‑material items + **opening stock** entered.

**Calculations (validate on 2–3 real cables)**
- [ ] Copper/PVC per‑metre matches a manual check (Cu = `size × 0.00896 × cores × 1.04`).
- [ ] Single‑core cables show **0 sheath kg** (✓ already correct).
- [ ] Stage cascade input metres look right vs scrap settings.

**Workflow**
- [ ] Plan → release creates WO + stages + material kit.
- [ ] Operators can record each stage and FG is booked on completion.
- [ ] Dispatch decrements FG stock.

**Gaps to close (tracked in §5)**
- [ ] Add Start/Complete‑stage + Cancel‑WO buttons to Order Tracking.
- [ ] Surface capacity infeasibility (`missedDue`) as a release‑time warning.
- [ ] Decide on the single‑core sheathing routing fix (§5).
- [ ] WO status‑change audit log (who/when).

**Reports/dashboards still missing** (nice‑to‑have): planned‑vs‑actual schedule, scrap
trend, on‑time‑delivery %, machine utilisation history.

---

## 5. Known issues & recommended fixes

### 🔴 R1 — Single‑core cables get a phantom Sheathing operation _(routing logic — needs your approval to change)_
`requiredStages()` **always** appends `sheathing`, and never consults `shThick`. So a
single‑core cable with no sheath (`shThick: 0`) still gets a **sheathing job scheduled**
(consuming time on the sheathing extruder), even though the MRP correctly returns **0 sheath
material** for it. Schedule and materials therefore disagree for 1C cables.

**Recommended one‑line fix** (in `src/services/cablePlanner/scheduler.js`, `requiredStages`):
```js
// only sheath when the cable actually has a sheath (multi-core, or shThick > 0)
if ((cable.cores || 1) >= CONST.SHEATH_TRIGGER_CORES || (cable.shThick || 0) > 0) {
  stages.push({ stage: "sheathing", perCore: false });
}
```
This is **production logic**, so per your standing rule I have **not** applied it — say the
word and I will, with an added unit test asserting 1C → `core` only and 2C+ unchanged.

### 🟡 R2 — Order Tracking missing controls
No Start/Complete‑stage buttons (operators must use the legacy shop‑floor page), no Cancel‑WO
button (the `cancelled` status is unreachable from the UI), and the `qc` state is hidden
(bucketed as "in progress"). Recommend adding these to the tracking screen.

### 🟡 R3 — Capacity infeasibility not surfaced
The scheduler returns `missedDue` when due dates can't be met, but the UI doesn't raise a
clear warning at release. Recommend a banner: "_N orders cannot meet their due date with
current capacity_".

### 🟡 R4 — No WO status‑change audit
WO/stage timestamps exist, but there's no who‑changed‑status‑when log. Recommend a small
`ppc_wo_status_log` (one migration) for traceability.

---

_Engine + tests verified green at time of writing. R1 is the only correctness defect found;
R2–R4 are completeness gaps, not miscalculations._

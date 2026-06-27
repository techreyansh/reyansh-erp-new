# Reyansh ERP — Go-Live Smoke Test

The pre-rollout gate. Run in a normal logged-in browser on **www.reyansherp.com**
(hard-refresh first). Tick each row; for anything broken note the **screen + what
happened** and hand it back for a fix. Test as the relevant role where noted
(CEO sees all; CRM = Dolly; Production/Store/QC = those operators).

Legend: ✅ works · ⚠️ works-but-odd · ❌ broken

---

## 0. Auth & access (per role)
- [ ] Sign in with Google → lands on the dashboard (no "Access could not be verified").
- [ ] CEO sees all modules; a non-CEO (e.g. CRM/Dolly) sees only their allowed modules.
- [ ] Sign out → sign back in works (session persists on refresh).

## 1. CRM — Prospects (CRM Pipeline)
- [ ] **Add company** → dialog shows the **Type: Prospect / Client** toggle; add a prospect → appears with a `PC#####` code.
- [ ] Drag a prospect to a new stage → "log next action" dialog fires → save works.
- [ ] Open a prospect → log an activity (note/call); it shows in the timeline.
- [ ] Set / edit **next action** (date + priority) → saves; shows on the card.
- [ ] Add a **collaborator** → chip appears; that user can then see the lead.
- [ ] Add a duplicate company name → **Claim it** path appears (no hard crash).

## 2. CRM — Clients (Client Pipeline)  ⭐ new
- [ ] **Add client** button (top bar) → add a client → appears with a `C#####` code.
- [ ] Drag a client across a lifecycle stage → saves.
- [ ] Open the management drawer → **Account owner** + **Collaborators (co-working)** both work.
- [ ] Set a **next action** on a client → saves (and if you try one you don't own, you get a clear "no permission" message, not a false success).
- [ ] Open full **Client-360** (expand) → make a change / convert → on close, the list **refreshes**.

## 3. CRM — Client-360 tabs & follow-ups
- [ ] Open a company 360 → every tab loads (Timeline, Tasks, Follow-up, Quotations, Orders) — none blank/erroring.
- [ ] Dashboard → **My Follow-ups** → clicking a follow-up opens that **company's 360** (not just the list).

## 4. Inventory  (also closes roadmap #2)
- [ ] **Receive** material (GRN / receipt) → on-hand increases; movement shows in **Material-360** history.
- [ ] **Issue** to a work order → on-hand decreases; movement appears.
- [ ] **Dispatch** a finished item → on-hand decreases; movement appears.
- [ ] **Finish** a work order → FG on-hand increases.
- [ ] Material Control list shows correct on-hand (matches the ledger); reorder flags look right.

## 5. Production
- [ ] **Upload a production log** (or open existing) → it parses / appears.
- [ ] **Production Intelligence** → KPIs, achievement trend, downtime, anomalies render for a date range with data.
- [ ] **Ask the production AI** → a preset (e.g. "Summarise this period") + a free-form question both return an answer.

## 6. Dispatch
- [ ] Dispatch tower / plan list loads; create or update a dispatch plan works.

## 7. Mobile / Factory-Ops PWA  (`/app` on a phone or narrow window)
- [ ] Tiles show per capability: **Store**, **Production**, **Quality** (CEO sees all).
- [ ] **Store → Receipt/Issue** → submit posts (works offline → syncs when back online).
- [ ] **Production → Log Output** → submit posts.
- [ ] **Quality → Record QC** → pick WO → Pass/Fail → submit posts; **Lookup** shows WOs + last QC. ⭐ new

## 8. Cross-cutting
- [ ] No red error toasts during normal use; browser console has no fatal errors on key screens.
- [ ] Pages load reasonably fast (no multi-second hangs on the dashboard / CRM board).
- [ ] Works on the phone you'll hand to operators (mobile layout usable).

---

## Go / No-Go
- **Blockers found:** _______________________________________________
- **Minor issues (ship + fix later):** ______________________________
- **Decision:** ☐ GO for rollout ☐ Fix blockers first

> Recently shipped & worth re-confirming live: add-client (§2), collaborators on
> clients (§2), 360-refresh-after-edit (§2), Production AI chat (§5), Quality
> mobile module (§7), inventory ledger cutover (§4).

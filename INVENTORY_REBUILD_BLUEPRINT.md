# Inventory Rebuild Blueprint — Reyansh International ERP

**Status:** Proposal for sign-off (2026-06-24). No prod changes made yet.
**Decision owner:** Abhishek (CEO). **Author:** Claude (acting CEO/architect).
**Mandate:** Clean rebuild that retires both old systems; cover RM → WIP → FG; serve store-keeper-on-mobile + office-on-desktop; give real stock value.

---

## 1. The thesis

> **One append-only stock ledger is the single source of truth. Every other number — on-hand, value, what-to-reorder, WIP — is a *projection* of that ledger. Nothing edits a quantity directly; everything posts a typed, signed movement.**

This is exactly how ERPNext (and every serious ERP) implements perpetual inventory, verified against its source code and docs. It is directly portable to our Supabase/Postgres + React stack. It fixes the root cause of "nothing matches the floor."

## 2. Why the current system fails (from the code audit)

There are **three** inventory systems and they don't agree:

| System | Tables | Who writes it | Verdict |
|---|---|---|---|
| Legacy sheet-based | `stock`, `finished_goods`, `bom`, `material_inward`, `material_issue`, `kitting_sheet` (jsonb) | Purchase **GRN** (`+stock`), Molding | Retire. Several screens query tables that don't exist in prod → hard errors. |
| PPC typed | `ppc_items`, `ppc_bom`, `ppc_stock`, `ppc_stock_transactions` (ledger!), `ppc_item_vendors`, `ppc_wo*` | Cable production issue/finish, dispatch | **Keep the bones.** Already has a typed ledger + receive/issue/dispatch/adjust RPCs. |
| Generic (dead) | `inventory_stock`, `inventory_transactions`, `update_inventory_transaction()` | Nobody | Delete. |

**The killer bug:** Purchase **adds** stock to the *legacy* table; production + dispatch **subtract** from the *PPC* table. The two halves of every item's life never meet, so on-hand is wrong on every screen. There is also **no valuation** anywhere — just a single `unit_cost` per item, so no rupee value of stock.

**Good news:** `ppc_stock_transactions` is already an append-only audit ledger, and the receive/issue/dispatch/adjust/finish RPCs already exist. The rebuild *promotes the ledger to the throne* and rewires every flow into it — it is not a from-scratch build.

## 3. Target architecture

```
                 ┌─────────────────────────────────────────┐
   Purchase GRN ─┤                                          │
   Prod consume ─┤   stock_ledger  (append-only, signed)    │── projects ──▶ stock_balance (item × location)
   Prod receive ─┤   item × location × lot × qty × value    │── projects ──▶ stock_value / valuation
   Dispatch     ─┤   typed movement, immutable rows         │── projects ──▶ reorder board, ABC, WIP, ageing
   Transfer     ─┤                                          │
   Adjust/count ─┤                                          │
                 └─────────────────────────────────────────┘
```

- **`stock_ledger`** — one row per movement. Carries: `item_id`, `location_id`, optional `lot_id`, `movement_type`, `qty_delta` (signed), `qty_after` (running balance), `incoming_rate` (landed cost in), `valuation_rate` (running weighted-avg), `value_delta`, `ref_type`/`ref_id` (GRN, WO, dispatch, count…), `posted_by`, `posted_at`. **Rows are never edited or deleted; a reversal posts an opposite row.**
- **`stock_balance`** — cached projection (item × location × lot) for fast reads; rebuilt from the ledger, never hand-edited.
- **Typed movements** (the only ways stock changes): `RECEIPT` (GRN), `ISSUE` (to production/kitting), `TRANSFER` (bin→bin, sets both - and +), `MFG_CONSUME` (RM into WIP), `MFG_RECEIVE` (FG out of WIP), `DISPATCH`, `ADJUST` (cycle-count correction), `SCRAP`/`SCRAP_RECOVER`.

## 4. Key design decisions (research-backed)

1. **Costing = Weighted Average (moving average).** Ind AS 2 / AS 2 permit only FIFO or weighted-average (LIFO banned) and require lower-of-cost-and-NRV. For volatile copper, weighted-average is the pragmatic default and avoids FIFO's expensive full-sequence "reposting" when a backdated GRN arrives. *(Confirm with the company CA before go-live.)*
2. **Landed cost captured at GRN.** Inventory value in = purchase price + freight + handling + non-creditable duties (BCD/SWS/anti-dumping for imports), **less** recoverable GST/IGST input credit (that's a tax asset, not a cost). Store it as `incoming_rate` on the RECEIPT row.
3. **Locations → bins.** `location` (store / WIP / FG / scrap) now, optional `bin` later. Every ledger row is location-scoped, enabling multi-store and putaway.
4. **Unit-of-measure with conversions.** Each item has a base UoM; a `uom_conversion` table holds factors (e.g. kg ↔ metres of a given cable, drum ↔ length). Transactions can be entered in a convenient UoM and stored in base — kills the "1000 pcs + 500 m in one bucket" class of errors.
5. **Lot / drum / spool identity (wire & cable).** Optional `lot_id` per receipt and per produced FG; a unique ID per spool/reel/drum so identical-looking stock from different suppliers/jobs is distinguishable. Delivers ISO 9001 traceability + supplier-defect recall + job costing. Pair with printed sequential footage markers for remaining-length reads.
6. **WIP via work-order backflush.** Issuing RM to a WO posts `MFG_CONSUME` into a WIP location; finishing posts `MFG_RECEIVE` of FG out of WIP. WIP value = ledger balance of the WIP location. Copper scrap recovered posts `SCRAP_RECOVER` back to stock.
7. **ABC cycle counting, not annual stocktake.** Classify items A/B/C by value; count A often, C rarely; **freeze only the counted bins** during a count; corrections post as `ADJUST` rows (full audit trail).

## 5. Data model (new / extended tables)

Reusing PPC where possible; new tables prefixed `inv_`:

- `inv_item` *(or extend `ppc_items`)* — item master: code, name, type (RM/semi/FG/consumable), base_uom, tracking (none|lot|serial), valuation_method, reorder fields.
- `inv_location` — store, WIP, FG, scrap, (bins later).
- `inv_uom_conversion` — item_id, from_uom, to_uom, factor.
- `inv_lot` — lot/drum id, item_id, supplier, mfg_date, grn_ref, initial_qty.
- **`inv_ledger`** — the spine (section 3).
- `inv_balance` — cached on-hand + value per item × location × lot.
- `inv_grn` / `inv_grn_line` — goods receipt header/lines with landed-cost breakup.
- `inv_count` / `inv_count_line` — cycle-count sessions.
- Movement RPCs (extend existing PPC ones): `inv_post_receipt`, `inv_post_issue`, `inv_post_transfer`, `inv_post_mfg_consume`, `inv_post_mfg_receive`, `inv_post_dispatch`, `inv_post_adjust` — each writes a ledger row + updates balance + valuation atomically.

## 6. UX — two front doors, one ledger

**Store-keeper on mobile** (fast, low-typing, error-resistant):
- Big-button home: **Receive · Issue · Transfer · Count**.
- Receive: scan/type item → qty → done (GRN). Issue: pick WO or reason → item → qty.
- Barcode/QR scan to identify item/lot; minimal forms; confirmation toasts; works on a cheap Android phone.
- Tolerant of flaky shop-floor wifi (queue the post, reconcile against the append-only ledger). *(Offline = later phase.)*

**Office on desktop** (control & insight):
- One **Inventory** screen: live on-hand + **value** by item/location, search, drill into the ledger (every movement, who/when/why).
- Reorder board (shortage, suggested qty, preferred vendor, days-of-cover — already prototyped in PPC).
- Valuation report, stock ageing, ABC dashboard, cycle-count scheduling + variance review, GRN landed-cost entry.

## 7. Migration plan (no big-bang; strangler pattern)

1. Stand up `inv_*` tables alongside the live system (zero user impact).
2. **Seed opening balances** from a one-time reconciliation: take the *truer* of legacy `stock`/`finished_goods` vs `ppc_stock` per item, write an `OPENING` ledger row each. (We'll review real prod data together before this.)
3. Repoint **one flow at a time** to the new RPCs: GRN first (stops the legacy/PPC divergence), then production issue/finish, then dispatch, then molding.
4. New Inventory screens read `inv_balance`; old screens stay until parity is proven.
5. Once parity holds for a cycle, **retire** legacy tables/routes and **delete** the dead `inventory_stock` system.

## 8. Phased rollout — build first vs defer

**Phase 1 — Foundation + reconciliation (the MVP that ends the chaos).**
Ledger + balance + valuation (weighted-avg) · item/location masters · `RECEIPT`/`ISSUE`/`ADJUST`/`DISPATCH` RPCs · rewire Purchase GRN + production + dispatch into the ONE ledger so quantities finally reconcile · one unified desktop Inventory screen with on-hand **and value** · data migration of opening balances. *This alone fixes P1 and gives real stock value.*

**Phase 2 — Store mobile + structure.**
Mobile receive/issue/transfer/count app (barcode/QR, big buttons) · bins · UoM conversions · reorder board live.

**Phase 3 — Traceability + accounting depth.**
Lot/drum identity + genealogy (recall) · WIP/backflush accounting · ABC cycle-count workflow + variance review · copper scrap recovery · stock ageing.

**Defer (until clearly needed):** FIFO option, standard-cost variance machinery, true offline sync with conflict resolution, in-transit transfers between physical sites.

## 9. Risks & guardrails

- **Live prod DB + 4 real users.** Strangler migration, never big-bang. Each flow cut over behind a check that new and old agree before retiring old.
- **Migration correctness.** Opening balances reviewed against real data with you before posting; everything is reversible (append a reversal, never delete).
- **Statutory.** Weighted-avg + landed-cost rules to be confirmed with the company CA before valuation goes to the books.
- **Scope discipline.** Phase 1 ships value fast; resist front-loading Phase 3 niceties.

## 10. The ask

1. Approve the **direction** (one-ledger architecture, weighted-average, strangler migration).
2. Approve starting **Phase 1**, beginning with a read-only look at *real prod inventory data* so we design opening-balance reconciliation correctly — still no writes.

---
*Sources: ERPNext stock-ledger source & docs, Microsoft D365 backflush costing, Ind AS 2 / AS 2 (ICAI/MCA via taxguru, ClearTax), NetSuite cycle-counting, eTurns/Cerrowire wire-&-cable practice. Full verified findings in the deep-research output for this session.*

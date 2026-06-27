# ppc_stock retirement — Stage 2 (execution plan)

Stage 1 (DONE, PR #41, migration 20260627130000): abc_class/xyz_class moved to
ppc_items; ppc_recompute_classification + ppcService.listStock repointed. reserved
already lives on inv_balance. ppc_stock is now only about **on_hand**.

Stage 2 retires ppc_stock entirely. It MUST land atomically (writers + readers +
view together) — the moment a writer stops updating ppc_stock.on_hand, any reader
still reading ppc_stock.on_hand shows stale stock. inv_ledger is append-only, so a
wrong movement is reversible (the smoke-test safety net).

## Single source of truth = inv_balance (on_hand) / inv_ledger (movements)

### Writers (6) — make inv_ledger the ONE writer per flow; stop writing ppc_stock
Verified: receive/adjust/dispatch services ALREADY post to inv via inv_post_by_id;
finishWorkOrder service ALREADY posts MFG_RECEIVE. So:
- `receiveStock` (ppcService:199): DROP the `ppc_receive_stock` RPC call; keep the
  inv RECEIPT mirror. Return {ok,item_id,on_hand} from inv_balance read.
- `adjustStock` (ppcService:229): DROP `ppc_adjust_stock`; keep the delta→inv ADJUST.
- `dispatchStock` (ppcService:258): DROP `ppc_dispatch_stock`; keep inv DISPATCH.
- `finishWorkOrder` (ppcService:773): the RPC `cable_finish_work_order` also does WO
  completion — KEEP that, but edit the RPC to REMOVE its ppc_stock INSERT/UPDATE
  (the service already posts MFG_RECEIVE to inv). Keep it returning
  item_id/produced/already_stocked.
- `issueMaterial` (ppcService:816): `ppc_issue_material` decrements ppc_stock +
  logs WO material. Edit RPC to post an inv ISSUE (inv_post_movement, RM @ STORE/WIP)
  instead of decrementing ppc_stock; keep the kitting/material-log logic. (Confirm
  whether kitting already goes through inv_issue_kit to avoid a double issue.)
- `ppc_import_bom` (ppcService:904): stop seeding ppc_stock.on_hand on import
  (on_hand is owned by inv now — opening stock comes via inv_open/inv_adjust). Keep
  the BOM/item upsert.

After this, NO code writes ppc_stock → safe to make it a view.

### Readers (4 RPCs + 1 service) — repoint on_hand to inv_balance
- `inv_control_dashboard`: valuation/below_reorder/stock_out/reserved → from
  inv_balance (sum on_hand per item) + ppc_items (unit_cost/reorder_point) + reserved
  from inv_balance.
- `ppc_excess_stock`: on_hand from inv_balance.
- `ppc_mrp`: the `LEFT JOIN ppc_stock s ON s.item_id=a.item_id` for on_hand → join a
  per-item inv_balance aggregate instead. (Inert until ppc_bom has data, but repoint.)
- `ppc_wo_shortage`: same LEFT JOIN → inv_balance aggregate.
- `inventoryControlService.listStock` (:20): reads `ppc_stock` w/ ppc_items embed →
  read ppc_items + inv_balance directly (mirror the Stage 1 listStock change).

### Swap ppc_stock → view (catches anything missed)
```sql
DROP TABLE public.ppc_stock CASCADE;  -- after writers/readers repointed; back up first
CREATE VIEW public.ppc_stock AS
  SELECT i.id AS id, i.id AS item_id,
         COALESCE(b.on_hand,0) AS on_hand, COALESCE(b.reserved,0) AS reserved,
         i.reorder_point, i.safety_stock, i.lead_time_days, i.location,
         i.max_qty, i.avg_daily_demand, i.abc_class, i.xyz_class, now() AS updated_at
  FROM public.ppc_items i
  LEFT JOIN (SELECT item_id, sum(on_hand) on_hand, sum(reserved) reserved
             FROM public.inv_balance GROUP BY item_id) b ON b.item_id = i.id;
```
NOTE: dropping the table also drops trg_ppc_stock_audit (writes ppc_stock_transactions
from ppc_stock changes). ppc_stock_transactions is read by ppc_recompute_classification
and the inventory transaction history — its rows must keep coming from somewhere. Decide:
either keep the audit by writing ppc_stock_transactions from the inv flows, or repoint
classification/history to inv_ledger. (inv_ledger IS the movement log — classification
+ history should read inv_ledger; retire ppc_stock_transactions too.)

## Verification (REQUIRES a stable prod connection)
Per flow, in a rolled-back txn as the authenticated role: run the flow, assert inv_ledger
got exactly ONE movement of the right sign/qty and inv_balance moved correctly, and that
ppc_stock (view) reflects it. Then DROP, then re-run the 4 reader RPCs and confirm on_hand
matches inv_balance. Then the user smoke-tests live: receive an item, issue to a WO,
dispatch, finish a WO → confirm on-hand is right on the Inventory + PPC screens.

## Open question to confirm before coding
issueMaterial vs inv_issue_kit: does kitting already post to inv? If yes, ppc_issue_material
must NOT also post (double issue). Resolve first.

## RETRY 2026-06-27 — DE-RISKED + open questions RESOLVED (then pooler-blocked at the gate)
Pulled all live function bodies (scratchpad/fnbodies.txt). Findings that SHRINK the work:
- **The 4 reader RPCs are FREE via the view** — inv_control_dashboard / ppc_excess_stock /
  ppc_mrp / ppc_wo_shortage read s.on_hand/reserved/reorder_point/max_qty/avg_daily_demand/
  item_id (NOT s.id). If ppc_stock becomes a VIEW exposing those (on_hand+reserved from
  inv_balance, config from ppc_items), they work UNCHANGED. Do NOT rewrite them.
- **All 6 write flows already mirror to inv at the SERVICE layer** (verified): receiveStock
  (RECEIPT), adjustStock (delta ADJUST), dispatchStock (DISPATCH), finishWorkOrder
  (MFG_RECEIVE), issueMaterial (MFG_CONSUME @STORE — yes, the legacy path mirrors too),
  import via... (import_bom seeds ppc_stock only). So inv_balance is the maintained truth.
- **Issue double-issue question RESOLVED:** both ppc_issue_material (service mirrors inv)
  and inv_issue_kit_line/inv_issue_kit (post inv directly) update qty_issued + post ONE inv
  MFG_CONSUME. No double. Just remove ppc_stock decrement from ppc_issue_material.
So Stage 2 = (a) remove ONLY the ppc_stock write blocks from 6 RPCs, keeping the rest:
  - cable_finish_work_order: drop the `INSERT INTO ppc_stock … ON CONFLICT` + the
    `SELECT on_hand FROM ppc_stock`; keep WO→done + fg_stocked_at guard; return on_hand
    from inv_balance (or 0).
  - ppc_issue_material: drop the `UPDATE ppc_stock SET on_hand=on_hand-p_qty`; keep
    qty_issued update + return.
  - ppc_import_bom: drop the entire `-- 3) stock` loop (opening stock comes via inv_open).
  - ppc_receive_stock / ppc_adjust_stock / ppc_dispatch_stock: drop their ppc_stock writes
    (services already post inv). Either neuter the RPC bodies OR drop the RPC calls in the
    service (services already have the inv mirror) — dropping the calls is simplest.
(b) DROP TABLE ppc_stock CASCADE (drops trg_ppc_stock_audit; back up first) + CREATE VIEW
    ppc_stock (see SQL above; expose id=i.id, item_id, on_hand+reserved from inv_balance agg,
    config + abc/xyz from ppc_items).
(c) repoint inventoryControlService.listStock (:20) to ppc_items+inv_balance (its PostgREST
    `ppc_items!ppc_stock_item_id_fkey` embed breaks on a view) — mirror the Stage 1 listStock fix.
(d) ppc_stock_transactions: after the swap the audit trigger is gone, so it stops getting
    rows; ppc_recompute_classification (180d consumption) + the transaction-history reads
    (inventoryControlService:45, ppcService:285) should repoint to inv_ledger. Follow-up.

### THE GATE (must pass before the swap) — BLOCKED 2026-06-27 by pooler timeouts
Confirm inv_balance(sum on_hand per item) == ppc_stock.on_hand per item (scratchpad/gate.js).
If matched → ledger complete → view is accurate → swap is safe. If diverged → some historical
movement never mirrored; backfill inv (inv_open/inv_adjust) to reconcile BEFORE the swap, else
dashboards/MRP would show different (canonical) numbers than today. Both poolers (5432 session
+ 6543 transaction) were ECHECKOUTTIMEOUT on every attempt — Supabase pooler degraded. Retry
the gate when the pooler recovers, then execute (a)–(c) in one atomic migration + deploy +
user smoke-test (receive / issue-to-WO / dispatch / finish-WO → on-hand correct).

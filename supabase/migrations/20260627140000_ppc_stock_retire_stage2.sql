-- ppc_stock retirement, Stage 2: make inv_balance the single on_hand source and
-- replace the ppc_stock TABLE with a VIEW over ppc_items + inv_balance.
--
-- GATE (verified 2026-06-27): per-item ppc_stock.on_hand == sum(inv_balance.on_hand)
-- for all 37 items — the ledger is complete, so the view is accurate.
--
-- The 6 stock-write RPCs lose their ppc_stock writes (the service layer already
-- posts every movement to inv_ledger: RECEIPT/ADJUST/DISPATCH/MFG_RECEIVE/MFG_CONSUME).
-- receive/adjust/dispatch become thin (return current inv on_hand) so the currently
-- deployed frontend keeps working with no gap; finish/issue/import keep their non-stock
-- logic. The 4 reader RPCs (inv_control_dashboard/ppc_excess_stock/ppc_mrp/ppc_wo_shortage)
-- are untouched — they read the view. (Follow-up: ppc_stock_transactions audit + history +
-- ppc_recompute_classification consumption should move to inv_ledger; the audit trigger is
-- gone with the table so ppc_stock_transactions stops gaining rows.)

BEGIN;

-- 0) Backup.
CREATE TABLE IF NOT EXISTS public._backup_ppc_stock_20260627 AS SELECT * FROM public.ppc_stock;

-- 1) cable_finish_work_order — FG receipt is booked to inv_ledger by the caller; just
--    complete the WO + mark stocked-once. on_hand returned from inv_balance.
CREATE OR REPLACE FUNCTION public.cable_finish_work_order(p_wo_id uuid, p_qty numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_item uuid; v_status text; v_planned numeric; v_produced numeric;
  v_already timestamptz; v_wo_number text; v_qty numeric; v_on numeric;
BEGIN
  SELECT item_id, status, qty, produced_qty, fg_stocked_at, wo_number
    INTO v_item, v_status, v_planned, v_produced, v_already, v_wo_number
  FROM public.ppc_wo WHERE id = p_wo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cable_finish_work_order: WO % not found', p_wo_id; END IF;
  IF v_status = 'cancelled' THEN RAISE EXCEPTION 'cable_finish_work_order: WO is cancelled'; END IF;
  IF v_item IS NULL THEN RAISE EXCEPTION 'cable_finish_work_order: WO has no item to stock'; END IF;
  v_qty := COALESCE(p_qty, NULLIF(v_produced, 0), v_planned, 0);
  UPDATE public.ppc_wo
     SET status='done', produced_qty=COALESCE(NULLIF(v_produced,0), v_qty), updated_at=now()
   WHERE id = p_wo_id;
  IF v_already IS NULL AND v_qty > 0 THEN
    UPDATE public.ppc_wo SET fg_stocked_at = now(), fg_stocked_qty = v_qty WHERE id = p_wo_id;
  END IF;
  SELECT COALESCE(sum(on_hand),0) INTO v_on FROM public.inv_balance WHERE item_id = v_item;
  RETURN jsonb_build_object('ok',true,'wo_id',p_wo_id,'item_id',v_item,'produced',v_qty,
    'on_hand',COALESCE(v_on,0),'already_stocked',v_already IS NOT NULL);
END;
$function$;

-- 2) ppc_issue_material — consumption booked to inv_ledger by the caller (MFG_CONSUME);
--    keep the qty_issued bookkeeping only.
CREATE OR REPLACE FUNCTION public.ppc_issue_material(p_wo_material_id uuid, p_qty numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_item_id uuid; v_issued numeric; v_required numeric; v_email text;
BEGIN
  IF p_wo_material_id IS NULL THEN RAISE EXCEPTION 'ppc_issue_material: p_wo_material_id is required'; END IF;
  IF COALESCE(p_qty,0) <= 0 THEN RAISE EXCEPTION 'ppc_issue_material: p_qty must be > 0'; END IF;
  v_email := public.rbac_current_email();
  UPDATE public.ppc_wo_material
     SET qty_issued = COALESCE(qty_issued,0) + p_qty, issued_by_email = v_email, issued_at = now()
   WHERE id = p_wo_material_id
   RETURNING item_id, qty_issued, qty_required INTO v_item_id, v_issued, v_required;
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'ppc_issue_material: kit line % not found', p_wo_material_id; END IF;
  RETURN jsonb_build_object('ok',true,'wo_material_id',p_wo_material_id,'item_id',v_item_id,
    'issued_now',p_qty,'qty_issued',v_issued,'qty_required',v_required,'stock_updated',true,'note',NULL);
END;
$function$;

-- 3) ppc_import_bom — items + BOM links only; opening stock comes via inv_open/inv_adjust.
CREATE OR REPLACE FUNCTION public.ppc_import_bom(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE it jsonb; bm jsonb; v_items_up int := 0; v_boms int := 0; v_parent uuid; v_comp uuid;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    IF COALESCE(trim(it->>'code'),'') = '' THEN CONTINUE; END IF;
    INSERT INTO public.ppc_items(code, name, item_type, uom, unit_cost, is_active)
    VALUES (trim(it->>'code'), NULLIF(trim(COALESCE(it->>'name','')),''),
            NULLIF(trim(COALESCE(it->>'item_type','')),''), NULLIF(trim(COALESCE(it->>'uom','')),''),
            NULLIF(it->>'unit_cost','')::numeric, true)
    ON CONFLICT (lower(code)) DO UPDATE
      SET name = COALESCE(EXCLUDED.name, public.ppc_items.name),
          item_type = COALESCE(EXCLUDED.item_type, public.ppc_items.item_type),
          uom = COALESCE(EXCLUDED.uom, public.ppc_items.uom),
          unit_cost = COALESCE(EXCLUDED.unit_cost, public.ppc_items.unit_cost),
          updated_at = now();
    v_items_up := v_items_up + 1;
  END LOOP;
  FOR bm IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'boms','[]'::jsonb)) LOOP
    SELECT id INTO v_parent FROM public.ppc_items WHERE lower(code)=lower(trim(bm->>'parent_code')) LIMIT 1;
    SELECT id INTO v_comp   FROM public.ppc_items WHERE lower(code)=lower(trim(bm->>'component_code')) LIMIT 1;
    IF v_parent IS NULL OR v_comp IS NULL OR v_parent = v_comp THEN CONTINUE; END IF;
    INSERT INTO public.ppc_bom(parent_item_id, component_item_id, qty_per, scrap_pct)
    VALUES (v_parent, v_comp, NULLIF(bm->>'qty_per','')::numeric, COALESCE(NULLIF(bm->>'scrap_pct','')::numeric,0))
    ON CONFLICT (parent_item_id, component_item_id) DO UPDATE
      SET qty_per = COALESCE(EXCLUDED.qty_per, public.ppc_bom.qty_per),
          scrap_pct = COALESCE(EXCLUDED.scrap_pct, public.ppc_bom.scrap_pct);
    v_boms := v_boms + 1;
  END LOOP;
  RETURN jsonb_build_object('items', v_items_up, 'boms', v_boms, 'stock', 0);
END $function$;

-- 4) receive/adjust/dispatch — no longer touch stock (the service posts the inv movement).
--    Kept as thin, signature-stable shims so the deployed frontend has no gap.
CREATE OR REPLACE FUNCTION public.ppc_receive_stock(p_item_id uuid, p_qty numeric, p_vendor_code text DEFAULT NULL, p_vendor_name text DEFAULT NULL, p_unit_cost numeric DEFAULT NULL, p_reference text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object('ok',true,'item_id',p_item_id,
    'on_hand',(SELECT COALESCE(sum(on_hand),0) FROM public.inv_balance WHERE item_id=p_item_id));
$function$;

CREATE OR REPLACE FUNCTION public.ppc_adjust_stock(p_item_id uuid, p_new_qty numeric, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object('ok',true,'item_id',p_item_id,
    'on_hand',(SELECT COALESCE(sum(on_hand),0) FROM public.inv_balance WHERE item_id=p_item_id));
$function$;

CREATE OR REPLACE FUNCTION public.ppc_dispatch_stock(p_item_id uuid, p_qty numeric, p_customer text DEFAULT NULL, p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object('ok',true,'item_id',p_item_id,
    'on_hand',(SELECT COALESCE(sum(on_hand),0) FROM public.inv_balance WHERE item_id=p_item_id));
$function$;

-- 5) Replace the table with a view over the canonical sources.
DROP TABLE public.ppc_stock;
CREATE VIEW public.ppc_stock AS
  SELECT i.id AS id, i.id AS item_id,
         COALESCE(b.on_hand,0)  AS on_hand,
         COALESCE(b.reserved,0) AS reserved,
         i.reorder_point, i.safety_stock, i.lead_time_days, i.location,
         i.max_qty, i.avg_daily_demand, i.abc_class, i.xyz_class,
         now() AS updated_at
  FROM public.ppc_items i
  LEFT JOIN (SELECT item_id, sum(on_hand) AS on_hand, sum(reserved) AS reserved
             FROM public.inv_balance GROUP BY item_id) b ON b.item_id = i.id;
GRANT SELECT ON public.ppc_stock TO authenticated;

COMMIT;

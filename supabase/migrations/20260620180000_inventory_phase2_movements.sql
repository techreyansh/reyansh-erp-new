-- Inventory Phase 2a: typed stock movements (receive / adjust / dispatch) that
-- write a properly-typed audit ledger. The audit trigger now reads a
-- transaction-local context (set by the movement RPCs) so each ledger row
-- records WHY stock moved (GRN / cycle-count / dispatch) + vendor + reference.
-- Component issue for work orders already flows via ppc_issue_material.
BEGIN;

-- Enriched audit trigger: prefer the RPC-supplied context, else infer.
CREATE OR REPLACE FUNCTION public.ppc_stock_audit_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta jsonb := NULLIF(current_setting('ppc.txn_meta', true), '')::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.on_hand IS DISTINCT FROM OLD.on_hand THEN
    INSERT INTO public.ppc_stock_transactions(item_id, quantity_delta, on_hand_after, transaction_type, reference_type, reference_id, notes, created_by_email)
    VALUES (NEW.item_id, NEW.on_hand - OLD.on_hand, NEW.on_hand,
            COALESCE(v_meta->>'type', CASE WHEN NEW.on_hand > OLD.on_hand THEN 'receipt' ELSE 'issue' END),
            v_meta->>'reference_type', v_meta->>'reference_id',
            COALESCE(v_meta->>'notes','auto'), v_meta->>'created_by');
  ELSIF TG_OP = 'INSERT' AND COALESCE(NEW.on_hand,0) <> 0 THEN
    INSERT INTO public.ppc_stock_transactions(item_id, quantity_delta, on_hand_after, transaction_type, reference_type, reference_id, notes, created_by_email)
    VALUES (NEW.item_id, NEW.on_hand, NEW.on_hand,
            COALESCE(v_meta->>'type','receipt'), v_meta->>'reference_type', v_meta->>'reference_id',
            COALESCE(v_meta->>'notes','opening'), v_meta->>'created_by');
  END IF;
  RETURN NEW;
END;
$$;

-- RECEIVE (GRN): add stock, remember vendor + last price.
CREATE OR REPLACE FUNCTION public.ppc_receive_stock(
  p_item_id uuid, p_qty numeric, p_vendor_code text DEFAULT NULL,
  p_vendor_name text DEFAULT NULL, p_unit_cost numeric DEFAULT NULL,
  p_reference text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on numeric; v_email text := public.current_user_email();
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Receive qty must be > 0'; END IF;
  PERFORM set_config('ppc.txn_meta', json_build_object(
    'type','receipt','reference_type','grn','reference_id',p_reference,
    'notes',COALESCE(p_note, NULLIF(concat('Receipt ', p_vendor_name), 'Receipt ')),
    'created_by',v_email)::text, true);
  INSERT INTO public.ppc_stock(item_id, on_hand) VALUES (p_item_id, p_qty)
    ON CONFLICT (item_id) DO UPDATE
      SET on_hand = public.ppc_stock.on_hand + EXCLUDED.on_hand, updated_at = now()
    RETURNING on_hand INTO v_on;
  IF p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN
    UPDATE public.ppc_items SET unit_cost = p_unit_cost WHERE id = p_item_id;
  END IF;
  IF p_vendor_code IS NOT NULL AND p_vendor_code <> '' THEN
    IF EXISTS (SELECT 1 FROM public.ppc_item_vendors WHERE item_id=p_item_id AND vendor_code=p_vendor_code) THEN
      UPDATE public.ppc_item_vendors
        SET unit_cost = COALESCE(p_unit_cost, unit_cost),
            vendor_name = COALESCE(p_vendor_name, vendor_name),
            last_quote_date = current_date
        WHERE item_id=p_item_id AND vendor_code=p_vendor_code;
    ELSE
      INSERT INTO public.ppc_item_vendors(item_id, vendor_code, vendor_name, unit_cost, last_quote_date, is_preferred)
      VALUES (p_item_id, p_vendor_code, p_vendor_name, p_unit_cost, current_date,
              NOT EXISTS (SELECT 1 FROM public.ppc_item_vendors WHERE item_id=p_item_id AND is_preferred));
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'on_hand',v_on);
END;
$$;

-- ADJUST (cycle count / correction): set on-hand to a counted value.
CREATE OR REPLACE FUNCTION public.ppc_adjust_stock(
  p_item_id uuid, p_new_qty numeric, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text := public.current_user_email();
BEGIN
  IF p_new_qty IS NULL OR p_new_qty < 0 THEN RAISE EXCEPTION 'Adjusted qty must be >= 0'; END IF;
  PERFORM set_config('ppc.txn_meta', json_build_object(
    'type','adjust','reference_type','cycle_count','notes',COALESCE(p_reason,'Adjustment'),
    'created_by',v_email)::text, true);
  INSERT INTO public.ppc_stock(item_id, on_hand) VALUES (p_item_id, p_new_qty)
    ON CONFLICT (item_id) DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = now();
  RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'on_hand',p_new_qty);
END;
$$;

-- DISPATCH (ship FG out): decrement on-hand, guard against negative.
CREATE OR REPLACE FUNCTION public.ppc_dispatch_stock(
  p_item_id uuid, p_qty numeric, p_customer text DEFAULT NULL, p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on numeric; v_email text := public.current_user_email();
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Dispatch qty must be > 0'; END IF;
  SELECT on_hand INTO v_on FROM public.ppc_stock WHERE item_id = p_item_id;
  IF v_on IS NULL THEN RAISE EXCEPTION 'No stock record for this item'; END IF;
  IF v_on < p_qty THEN RAISE EXCEPTION 'Insufficient stock: % available, % requested', v_on, p_qty; END IF;
  PERFORM set_config('ppc.txn_meta', json_build_object(
    'type','dispatch','reference_type','dispatch','reference_id',p_reference,
    'notes',concat('Dispatch to ', COALESCE(p_customer,'customer')),'created_by',v_email)::text, true);
  UPDATE public.ppc_stock SET on_hand = on_hand - p_qty, updated_at = now()
    WHERE item_id = p_item_id RETURNING on_hand INTO v_on;
  RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'on_hand',v_on);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ppc_receive_stock(uuid,numeric,text,text,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_adjust_stock(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_dispatch_stock(uuid,numeric,text,text) TO authenticated;

COMMIT;

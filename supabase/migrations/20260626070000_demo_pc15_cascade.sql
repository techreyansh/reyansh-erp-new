-- Finish the DEMO-PC15 cleanup: it has a linked work order. Delete the WO chain
-- (stages/status-log/materials cascade off ppc_wo) + stock/vendors/ledger, then the
-- item. If any other FK still blocks it, fall back to deactivating it (so it leaves
-- active lists). Guarded so a surprise never aborts.
DO $$
DECLARE v_item uuid;
BEGIN
  SELECT id INTO v_item FROM public.ppc_items WHERE code = 'DEMO-PC15';
  IF v_item IS NULL THEN RAISE NOTICE 'DEMO CLEANUP | DEMO-PC15 already gone'; RETURN; END IF;
  BEGIN
    DELETE FROM public.ppc_wo WHERE item_id = v_item;            -- cascades stages/status_log/materials
    DELETE FROM public.ppc_item_vendors WHERE item_id = v_item;
    DELETE FROM public.ppc_stock WHERE item_id = v_item;
    DELETE FROM public.inv_balance WHERE item_id = v_item;
    DELETE FROM public.inv_ledger WHERE item_id = v_item;
    DELETE FROM public.ppc_items WHERE id = v_item;
    RAISE NOTICE 'DEMO CLEANUP | DEMO-PC15 + its work order fully removed';
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.ppc_items SET is_active = false WHERE id = v_item;
    RAISE NOTICE 'DEMO CLEANUP | DEMO-PC15 still FK-linked (%) — deactivated instead', SQLERRM;
  END;
END $$;

-- Guided legacy-BOM importer for PPC.
-- PPC (ppc_items/ppc_bom/ppc_stock) is the single inventory source of truth but
-- is empty; the old company_bom_data holds a handful of rich BOMs (product +
-- cable/moulding material lists) and company_material_issue_data holds on-hand
-- balances. This adds:
--   * unique keys so imports are idempotent (re-runnable without duplicates),
--   * ppc_legacy_bom_source()  — read raw legacy rows (SECDEF, RLS-independent),
--   * ppc_import_bom(payload)  — write reviewed items + BOM links + stock.
-- No legacy table is dropped or mutated; the importer only INSERTs/UPSERTs into PPC.
BEGIN;

-- Idempotency keys (only create if absent; ignore if a clashing dupe somehow exists).
CREATE UNIQUE INDEX IF NOT EXISTS ppc_items_code_uq ON public.ppc_items (lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS ppc_stock_item_uq ON public.ppc_stock (item_id);
CREATE UNIQUE INDEX IF NOT EXISTS ppc_bom_pair_uq  ON public.ppc_bom (parent_item_id, component_item_id);

-- Raw legacy source for the importer UI to parse/preview (avoids depending on the
-- legacy tables' RLS from the browser).
CREATE OR REPLACE FUNCTION public.ppc_legacy_bom_source()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'boms', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'bom_id', b."id", 'product_code', b."productCode", 'product_description', b."productDescription",
                'length', b."length", 'colour', b."colour",
                'cable_materials', b."cableMaterials", 'moulding_materials', b."mouldingMaterials",
                'last_updated', b."lastUpdated") ORDER BY b."lastUpdated" DESC NULLS LAST)
              FROM public.company_bom_data b), '[]'::jsonb),
    'issues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'kitting_id', m."uniqueKittingId", 'bom_id', m."bomId",
                'details', m."itemIssueDetails", 'created_at', m.created_at) ORDER BY m.created_at DESC NULLS LAST)
              FROM public.company_material_issue_data m), '[]'::jsonb),
    'already_imported', (SELECT count(*) FROM public.ppc_items)
  );
$$;
GRANT EXECUTE ON FUNCTION public.ppc_legacy_bom_source() TO authenticated;

-- Apply a reviewed import. payload = {
--   items: [{code,name,item_type,uom,unit_cost}],         -- products + materials, deduped by code
--   boms:  [{parent_code,component_code,qty_per,scrap_pct}],
--   stock: [{code,on_hand,location}]
-- } Idempotent: items upsert by lower(code); bom links upsert by (parent,component);
-- stock upsert by item. Returns a counts summary.
CREATE OR REPLACE FUNCTION public.ppc_import_bom(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it jsonb; bm jsonb; st jsonb;
  v_items_up int := 0; v_boms int := 0; v_stock int := 0;
  v_parent uuid; v_comp uuid; v_item uuid;
BEGIN
  -- 1) items
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

  -- 2) bom links
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

  -- 3) stock
  FOR st IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'stock','[]'::jsonb)) LOOP
    SELECT id INTO v_item FROM public.ppc_items WHERE lower(code)=lower(trim(st->>'code')) LIMIT 1;
    IF v_item IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.ppc_stock(item_id, on_hand, location, updated_at)
    VALUES (v_item, COALESCE(NULLIF(st->>'on_hand','')::numeric,0), NULLIF(trim(COALESCE(st->>'location','')),''), now())
    ON CONFLICT (item_id) DO UPDATE
      SET on_hand = COALESCE(EXCLUDED.on_hand, public.ppc_stock.on_hand),
          location = COALESCE(EXCLUDED.location, public.ppc_stock.location),
          updated_at = now();
    v_stock := v_stock + 1;
  END LOOP;

  RETURN jsonb_build_object('items', v_items_up, 'boms', v_boms, 'stock', v_stock);
END $$;
GRANT EXECUTE ON FUNCTION public.ppc_import_bom(jsonb) TO authenticated;

COMMIT;

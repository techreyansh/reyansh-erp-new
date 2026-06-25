-- =====================================================================
-- Product <-> BOM bridge — make ppc_bom the single BOM source
-- =====================================================================
-- Each PLM product maps to one manufacturable item (ppc_items); its BOM is the
-- ppc_bom rows on that item. Reuses the recursive ppc_bom + ppc_mrp explosion +
-- the existing BOM editor. No new BOM store. Additive.
-- =====================================================================

ALTER TABLE public.product
  ADD COLUMN IF NOT EXISTS ppc_item_id uuid REFERENCES public.ppc_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_ppc_item ON public.product (ppc_item_id);

-- Ensure a product has a manufacturable item (finished good). Idempotent:
-- returns the existing link, or mints a ppc_item from the product code/name and
-- links it. The BOM editor then hangs ppc_bom rows off this item.
CREATE OR REPLACE FUNCTION public.product_ensure_item(p_product_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item uuid; v_code text; v_name text; v_family text;
BEGIN
  SELECT ppc_item_id, product_code, product_name, product_family
    INTO v_item, v_code, v_name, v_family
  FROM public.product WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product not found'; END IF;
  IF v_item IS NOT NULL THEN RETURN v_item; END IF;

  INSERT INTO public.ppc_items (code, name, item_type, uom)
  VALUES (COALESCE(v_code, 'PRD-' || left(p_product_id::text, 8)),
          COALESCE(v_name, 'Product'),
          CASE WHEN v_family ILIKE '%power cord%' THEN 'power_cord'
               WHEN v_family ILIKE '%harness%' THEN 'harness'
               WHEN v_family ILIKE '%cable%' THEN 'cable'
               ELSE 'finished_good' END,
          'pcs')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_item;

  UPDATE public.product SET ppc_item_id = v_item, updated_at = now() WHERE id = p_product_id;
  RETURN v_item;
END $$;
GRANT EXECUTE ON FUNCTION public.product_ensure_item(uuid) TO authenticated;

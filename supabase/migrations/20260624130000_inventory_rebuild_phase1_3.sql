-- =====================================================================
-- Inventory Rebuild — Phase 1.3: by-id movement wrapper (for flow cutover)
-- =====================================================================
-- Additive only. Adds an item_id-keyed wrapper around inv_post_movement so the
-- production / dispatch service methods (which hold the item UUID, not its code)
-- can mirror their movements into the perpetual ledger without an extra lookup.
-- allow_negative = true here: a ledger mirror must never block a production or
-- dispatch action that already succeeded on the ppc side.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.inv_post_by_id(
  p_item_id        uuid,
  p_location_code  text,
  p_type           text,
  p_qty_delta      numeric,
  p_rate           numeric DEFAULT NULL,
  p_ref_type       text    DEFAULT 'ppc',
  p_ref_id         text    DEFAULT NULL,
  p_reason         text    DEFAULT NULL
) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    p_item_id,
    public.inv_location_id(p_location_code),
    p_type,
    p_qty_delta,
    p_rate,
    p_ref_type,
    p_ref_id,
    p_reason,
    true);
$$;

GRANT EXECUTE ON FUNCTION
  public.inv_post_by_id(uuid, text, text, numeric, numeric, text, text, text)
TO authenticated;

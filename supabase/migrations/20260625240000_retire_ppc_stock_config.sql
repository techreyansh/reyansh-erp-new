-- =====================================================================
-- Inventory — finish retiring ppc_stock as a CONFIG source.
-- =====================================================================
-- Batch 1 (20260625160000) moved reorder_point to ppc_items. This moves the
-- rest of the planning config (safety_stock, lead_time_days, location, max_qty,
-- avg_daily_demand) onto the item master too, and repoints the planning RPCs to
-- enumerate FROM ppc_items (not ppc_stock) — fixing the flagged gap where an item
-- with a reorder_point on ppc_items but NO ppc_stock row never appeared on the
-- reorder board / low-stock alerts. on_hand still comes from the inv_balance
-- ledger; vendor from ppc_item_vendors. ppc_stock keeps on_hand + abc/xyz (the
-- classification RPC owns those) until the on-hand cutover / table drop (later).
-- Additive + idempotent.
-- =====================================================================

-- 1. Add the remaining config columns to the item master.
ALTER TABLE public.ppc_items
  ADD COLUMN IF NOT EXISTS safety_stock     numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days   int     DEFAULT 7,
  ADD COLUMN IF NOT EXISTS location         text,
  ADD COLUMN IF NOT EXISTS max_qty          numeric,
  ADD COLUMN IF NOT EXISTS avg_daily_demand numeric;

-- 2. One-time backfill from ppc_stock (these columns exist on prod — the live
--    RPCs already reference s.max_qty / s.avg_daily_demand). Guarded so re-runs
--    don't clobber edits made on ppc_items.
UPDATE public.ppc_items i
   SET safety_stock     = COALESCE(NULLIF(i.safety_stock, 0), s.safety_stock),
       lead_time_days   = COALESCE(NULLIF(i.lead_time_days, 7), s.lead_time_days),
       location         = COALESCE(i.location, s.location),
       max_qty          = COALESCE(i.max_qty, s.max_qty),
       avg_daily_demand = COALESCE(i.avg_daily_demand, s.avg_daily_demand)
  FROM public.ppc_stock s
 WHERE s.item_id = i.id;

-- 3. Reorder board — enumerate FROM ppc_items (fixes the gap); all config from i.
CREATE OR REPLACE FUNCTION public.ppc_reorder_board()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.shortage DESC), '[]'::jsonb)
  FROM (
    SELECT
      i.id AS item_id, i.code, i.name, i.item_type, i.uom,
      oh.on_hand, i.reorder_point, i.safety_stock, i.lead_time_days, i.location,
      GREATEST(COALESCE(i.reorder_point,0) - COALESCE(oh.on_hand,0), 0) AS shortage,
      CEIL(GREATEST(
        COALESCE(i.max_qty, COALESCE(i.reorder_point,0) * 2) - COALESCE(oh.on_hand,0),
        COALESCE(pv.moq, 0)
      ))::numeric AS suggested_qty,
      CASE WHEN COALESCE(i.avg_daily_demand,0) > 0
           THEN ROUND(oh.on_hand / i.avg_daily_demand, 1) END AS days_of_cover,
      pv.vendor_code, pv.vendor_name,
      COALESCE(pv.lead_time_days, i.lead_time_days) AS vendor_lead_time,
      pv.unit_cost AS vendor_unit_cost
    FROM public.ppc_items i
    LEFT JOIN public.ppc_item_vendors pv ON pv.item_id = i.id AND pv.is_preferred
    CROSS JOIN LATERAL (
      SELECT COALESCE((SELECT sum(b.on_hand) FROM public.inv_balance b WHERE b.item_id = i.id), 0) AS on_hand
    ) oh
    WHERE i.is_active
      AND COALESCE(i.reorder_point,0) > 0
      AND COALESCE(oh.on_hand,0) <= COALESCE(i.reorder_point,0)
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.ppc_reorder_board() TO authenticated;

-- 4. Low-stock alerts — enumerate FROM ppc_items.
CREATE OR REPLACE FUNCTION public.ppc_low_stock()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'item_id',       i.id,
        'code',          i.code,
        'name',          i.name,
        'on_hand',       COALESCE(oh.on_hand, 0),
        'reorder_point', COALESCE(i.reorder_point, 0),
        'shortage',      GREATEST(0, COALESCE(i.reorder_point, 0) - COALESCE(oh.on_hand, 0))
      )
      ORDER BY GREATEST(0, COALESCE(i.reorder_point, 0) - COALESCE(oh.on_hand, 0)) DESC, i.code
    ),
    '[]'::jsonb
  )
  FROM public.ppc_items i
  CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT sum(b.on_hand) FROM public.inv_balance b WHERE b.item_id = i.id), 0) AS on_hand
  ) oh
  WHERE i.is_active IS NOT FALSE
    AND COALESCE(i.reorder_point, 0) > 0
    AND COALESCE(oh.on_hand, 0) <= COALESCE(i.reorder_point, 0);
$fn$;
GRANT EXECUTE ON FUNCTION public.ppc_low_stock() TO authenticated;

-- Rollback: the columns are additive (leave them); restore the prior RPC bodies
-- from 20260625160000_inv_reorder_to_items.sql if reverting.

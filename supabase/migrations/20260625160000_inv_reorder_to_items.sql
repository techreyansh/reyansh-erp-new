-- =====================================================================
-- Inventory — move the reorder threshold off ppc_stock onto ppc_items
-- =====================================================================
-- The reorder THRESHOLD is an item-master property, not a per-stock-row
-- attribute. Move it to ppc_items.reorder_point and repoint the planning
-- reads. Scope is the reorder threshold ONLY.
--
-- reorder_point now lives on ppc_items; ppc_stock keeps safety_stock/max_qty/vendor until full retirement (later phase).
-- =====================================================================

-- 1. Add the column to the item master.
ALTER TABLE public.ppc_items ADD COLUMN IF NOT EXISTS reorder_point numeric DEFAULT 0;

-- 2. One-time backfill from ppc_stock. Guarded so re-runs don't clobber
--    manual edits: only copy when ppc_stock has a value and ppc_items is unset.
UPDATE public.ppc_items i
SET reorder_point = s.reorder_point
FROM public.ppc_stock s
WHERE s.item_id = i.id
  AND COALESCE(s.reorder_point, 0) > 0
  AND COALESCE(i.reorder_point, 0) = 0;

-- 3. Repoint the two planning RPCs to read the threshold from ppc_items.
--    safety_stock, lead_time_days, location, max_qty, avg_daily_demand stay
--    sourced from ppc_stock (s).

-- Reorder board: shortage / suggested qty / preferred vendor / days-of-cover,
-- driven by ledger on-hand; reorder threshold now from ppc_items (i).
CREATE OR REPLACE FUNCTION public.ppc_reorder_board()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.shortage DESC), '[]'::jsonb)
  FROM (
    SELECT
      i.id AS item_id, i.code, i.name, i.item_type, i.uom,
      oh.on_hand, i.reorder_point, s.safety_stock, s.lead_time_days, s.location,
      GREATEST(COALESCE(i.reorder_point,0) - COALESCE(oh.on_hand,0), 0) AS shortage,
      CEIL(GREATEST(
        COALESCE(s.max_qty, COALESCE(i.reorder_point,0) * 2) - COALESCE(oh.on_hand,0),
        COALESCE(pv.moq, 0)
      ))::numeric AS suggested_qty,
      CASE WHEN COALESCE(s.avg_daily_demand,0) > 0
           THEN ROUND(oh.on_hand / s.avg_daily_demand, 1) END AS days_of_cover,
      pv.vendor_code, pv.vendor_name,
      COALESCE(pv.lead_time_days, s.lead_time_days) AS vendor_lead_time,
      pv.unit_cost AS vendor_unit_cost
    FROM public.ppc_stock s
    JOIN public.ppc_items i ON i.id = s.item_id AND i.is_active
    LEFT JOIN public.ppc_item_vendors pv ON pv.item_id = s.item_id AND pv.is_preferred
    CROSS JOIN LATERAL (
      SELECT COALESCE((SELECT sum(b.on_hand) FROM public.inv_balance b WHERE b.item_id = s.item_id), 0) AS on_hand
    ) oh
    WHERE COALESCE(oh.on_hand,0) <= COALESCE(i.reorder_point,0)
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.ppc_reorder_board() TO authenticated;

-- Low-stock alerts, driven by ledger on-hand; reorder threshold now from
-- ppc_items (it).
CREATE OR REPLACE FUNCTION public.ppc_low_stock()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'item_id',       it.id,
        'code',          it.code,
        'name',          it.name,
        'on_hand',       COALESCE(oh.on_hand, 0),
        'reorder_point', COALESCE(it.reorder_point, 0),
        'shortage',      GREATEST(0, COALESCE(it.reorder_point, 0) - COALESCE(oh.on_hand, 0))
      )
      ORDER BY GREATEST(0, COALESCE(it.reorder_point, 0) - COALESCE(oh.on_hand, 0)) DESC, it.code
    ),
    '[]'::jsonb
  )
  FROM public.ppc_stock s
  JOIN public.ppc_items it ON it.id = s.item_id
  CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT sum(b.on_hand) FROM public.inv_balance b WHERE b.item_id = s.item_id), 0) AS on_hand
  ) oh
  WHERE COALESCE(oh.on_hand, 0) <= COALESCE(it.reorder_point, 0)
    AND it.is_active IS NOT FALSE;
$fn$;
GRANT EXECUTE ON FUNCTION public.ppc_low_stock() TO authenticated;

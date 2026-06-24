-- =====================================================================
-- Inventory cutover — planning reads source on-hand from the ledger
-- =====================================================================
-- The perpetual ledger (inv_ledger/inv_balance) is the single source of truth
-- for stock. GRN, kit-issue, production and dispatch all write it. But the
-- planning RPCs still read ppc_stock.on_hand, which is now stale. Repoint the
-- two user-facing planning signals to source on-hand from inv_balance (planning
-- config — reorder_point/safety_stock/vendor — stays on ppc_stock).
--
-- DEFERRED: ppc_mrp (recursive CTE) is inert until BOMs exist (ppc_bom is
-- empty); its on-hand source will be repointed when BOM data lands, to avoid
-- rewriting the recursion blind. ppc_wo_shortage is superseded by inv_issue_kit
-- (which checks inv_balance directly). Replaceable functions only — additive.
-- =====================================================================

-- Reorder board: shortage / suggested qty / preferred vendor / days-of-cover,
-- now driven by ledger on-hand.
CREATE OR REPLACE FUNCTION public.ppc_reorder_board()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.shortage DESC), '[]'::jsonb)
  FROM (
    SELECT
      i.id AS item_id, i.code, i.name, i.item_type, i.uom,
      oh.on_hand, s.reorder_point, s.safety_stock, s.lead_time_days, s.location,
      GREATEST(COALESCE(s.reorder_point,0) - COALESCE(oh.on_hand,0), 0) AS shortage,
      CEIL(GREATEST(
        COALESCE(s.max_qty, COALESCE(s.reorder_point,0) * 2) - COALESCE(oh.on_hand,0),
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
    WHERE COALESCE(oh.on_hand,0) <= COALESCE(s.reorder_point,0)
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.ppc_reorder_board() TO authenticated;

-- Low-stock alerts, now driven by ledger on-hand.
CREATE OR REPLACE FUNCTION public.ppc_low_stock()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'item_id',       it.id,
        'code',          it.code,
        'name',          it.name,
        'on_hand',       COALESCE(oh.on_hand, 0),
        'reorder_point', COALESCE(s.reorder_point, 0),
        'shortage',      GREATEST(0, COALESCE(s.reorder_point, 0) - COALESCE(oh.on_hand, 0))
      )
      ORDER BY GREATEST(0, COALESCE(s.reorder_point, 0) - COALESCE(oh.on_hand, 0)) DESC, it.code
    ),
    '[]'::jsonb
  )
  FROM public.ppc_stock s
  JOIN public.ppc_items it ON it.id = s.item_id
  CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT sum(b.on_hand) FROM public.inv_balance b WHERE b.item_id = s.item_id), 0) AS on_hand
  ) oh
  WHERE COALESCE(oh.on_hand, 0) <= COALESCE(s.reorder_point, 0)
    AND it.is_active IS NOT FALSE;
$fn$;
GRANT EXECUTE ON FUNCTION public.ppc_low_stock() TO authenticated;

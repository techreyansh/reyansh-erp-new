-- Retire the legacy `ppc_stock` VIEW. inv_balance (perpetual ledger) is already
-- the source of truth; ppc_stock was a thin view over ppc_items + inv_balance.
-- The 4 reader RPCs that still referenced it are repointed by INLINING the view
-- as a local `ppc_stock` CTE (identical columns → behavior unchanged), then the
-- view is dropped. No app/frontend change (RPC bodies only). ppc_reorder_board /
-- ppc_low_stock were already repointed in 20260625240000.
BEGIN;

-- ---- 1. inv_control_dashboard ------------------------------------------------
create or replace function public.inv_control_dashboard()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with ppc_stock as (
    select i.id as item_id,
           coalesce(b.on_hand,0) as on_hand, coalesce(b.reserved,0) as reserved,
           i.reorder_point, i.safety_stock, i.lead_time_days, i.location,
           i.max_qty, i.avg_daily_demand, i.abc_class, i.xyz_class
    from public.ppc_items i
    left join (select item_id, sum(on_hand) as on_hand, sum(reserved) as reserved
               from public.inv_balance group by item_id) b on b.item_id = i.id
  )
  select jsonb_build_object(
    'total_items', (select count(*) from ppc_items where is_active),
    'raw_count',  (select count(*) from ppc_items where item_type='raw_material' and is_active),
    'semi_count', (select count(*) from ppc_items where item_type='semi_finished' and is_active),
    'fg_count',   (select count(*) from ppc_items where item_type in ('finished_good','cable','power_cord','harness') and is_active),
    'total_valuation', (select coalesce(sum(st.on_hand * coalesce(i.unit_cost,0)),0) from ppc_stock st join ppc_items i on i.id=st.item_id),
    'reserved_total',  (select coalesce(sum(reserved),0) from ppc_stock),
    'below_reorder',   (select count(*) from ppc_stock where reorder_point>0 and on_hand <= reorder_point),
    'stock_out',       (select count(*) from ppc_stock where on_hand <= 0),
    'below_reorder_items', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', i.code, 'name', i.name, 'on_hand', st.on_hand, 'reserved', st.reserved,
        'available', st.on_hand - st.reserved, 'reorder_point', st.reorder_point, 'uom', i.uom) order by st.on_hand), '[]'::jsonb)
      from ppc_stock st join ppc_items i on i.id=st.item_id where st.reorder_point>0 and st.on_hand <= st.reorder_point)
  );
$function$;

-- ---- 2. ppc_excess_stock -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_excess_stock(p_cover_threshold numeric DEFAULT 120)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ppc_stock AS (
    SELECT i.id AS item_id,
           COALESCE(b.on_hand,0) AS on_hand, COALESCE(b.reserved,0) AS reserved,
           i.reorder_point, i.safety_stock, i.lead_time_days, i.location,
           i.max_qty, i.avg_daily_demand, i.abc_class, i.xyz_class
    FROM public.ppc_items i
    LEFT JOIN (SELECT item_id, sum(on_hand) AS on_hand, sum(reserved) AS reserved
               FROM public.inv_balance GROUP BY item_id) b ON b.item_id = i.id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.over_qty DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      i.id AS item_id, i.code, i.name, i.item_type, i.uom,
      s.on_hand, s.max_qty,
      CASE WHEN COALESCE(s.avg_daily_demand,0) > 0
           THEN ROUND(s.on_hand / s.avg_daily_demand, 1) END AS days_of_cover,
      CASE WHEN s.max_qty IS NOT NULL AND s.on_hand > s.max_qty
           THEN s.on_hand - s.max_qty END AS over_qty
    FROM ppc_stock s
    JOIN public.ppc_items i ON i.id = s.item_id AND i.is_active
    WHERE (s.max_qty IS NOT NULL AND s.on_hand > s.max_qty)
       OR (COALESCE(s.avg_daily_demand,0) > 0 AND s.on_hand / s.avg_daily_demand > p_cover_threshold)
  ) t;
$$;

-- ---- 3. ppc_wo_shortage ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_wo_shortage(p_wo_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ppc_stock AS (
    SELECT i.id AS item_id,
           COALESCE(b.on_hand,0) AS on_hand, COALESCE(b.reserved,0) AS reserved,
           i.reorder_point, i.safety_stock, i.lead_time_days, i.location,
           i.max_qty, i.avg_daily_demand, i.abc_class, i.xyz_class
    FROM public.ppc_items i
    LEFT JOIN (SELECT item_id, sum(on_hand) AS on_hand, sum(reserved) AS reserved
               FROM public.inv_balance GROUP BY item_id) b ON b.item_id = i.id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.shortfall DESC), '[]'::jsonb)
  FROM (
    SELECT m.item_id, i.code, i.name, i.uom,
           m.qty_required, m.qty_issued,
           COALESCE(s.on_hand, 0) AS on_hand,
           GREATEST(m.qty_required - COALESCE(m.qty_issued,0) - COALESCE(s.on_hand,0), 0) AS shortfall
    FROM public.ppc_wo_material m
    JOIN public.ppc_items i ON i.id = m.item_id
    LEFT JOIN ppc_stock s ON s.item_id = m.item_id
    WHERE m.work_order_id = p_wo_id
  ) t;
$$;

-- ---- 4. ppc_mrp (recursive BOM explosion) ------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_mrp(p_item_id uuid, p_qty numeric)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH RECURSIVE explosion AS (
    SELECT
      b.component_item_id                                              AS item_id,
      (p_qty * b.qty_per * (1 + b.scrap_pct / 100.0))::numeric         AS required,
      1                                                                AS depth,
      ARRAY[p_item_id, b.component_item_id]                            AS path
    FROM public.ppc_bom b
    WHERE b.parent_item_id = p_item_id
    UNION ALL
    SELECT
      b.component_item_id                                              AS item_id,
      (e.required * b.qty_per * (1 + b.scrap_pct / 100.0))::numeric    AS required,
      e.depth + 1                                                      AS depth,
      e.path || b.component_item_id                                    AS path
    FROM explosion e
    JOIN public.ppc_bom b ON b.parent_item_id = e.item_id
    WHERE e.depth < 10
      AND NOT (b.component_item_id = ANY (e.path))
  ),
  agg AS (
    SELECT item_id, SUM(required)::numeric AS required FROM explosion GROUP BY item_id
  ),
  ppc_stock AS (
    SELECT i.id AS item_id,
           COALESCE(b.on_hand,0) AS on_hand, COALESCE(b.reserved,0) AS reserved,
           i.reorder_point, i.safety_stock, i.lead_time_days, i.location,
           i.max_qty, i.avg_daily_demand, i.abc_class, i.xyz_class
    FROM public.ppc_items i
    LEFT JOIN (SELECT item_id, sum(on_hand) AS on_hand, sum(reserved) AS reserved
               FROM public.inv_balance GROUP BY item_id) b ON b.item_id = i.id
  ),
  lines AS (
    SELECT
      a.item_id, it.code, it.name, it.item_type,
      COALESCE(it.uom, 'pcs')                                         AS uom,
      a.required,
      COALESCE(s.on_hand, 0)::numeric                                 AS on_hand,
      COALESCE(s.reorder_point, 0)::numeric                           AS reorder_point,
      COALESCE(s.lead_time_days, 0)                                   AS lead_time_days,
      GREATEST(0, a.required - COALESCE(s.on_hand, 0))::numeric       AS shortage,
      ((COALESCE(s.on_hand, 0) - a.required) < COALESCE(s.reorder_point, 0)) AS below_reorder,
      (a.required * COALESCE(it.unit_cost, 0))::numeric               AS est_cost
    FROM agg a
    LEFT JOIN public.ppc_items it ON it.id = a.item_id
    LEFT JOIN ppc_stock s  ON s.item_id = a.item_id
  )
  SELECT jsonb_build_object(
    'item_id', p_item_id,
    'qty',     p_qty,
    'lines',   COALESCE(
                 (SELECT jsonb_agg(
                    jsonb_build_object(
                      'item_id',         l.item_id,
                      'code',            l.code,
                      'name',            l.name,
                      'item_type',       l.item_type,
                      'uom',             l.uom,
                      'required',        l.required,
                      'on_hand',         l.on_hand,
                      'reorder_point',   l.reorder_point,
                      'lead_time_days',  l.lead_time_days,
                      'shortage',        l.shortage,
                      'below_reorder',   l.below_reorder,
                      'suggest_purchase',(l.shortage > 0),
                      'est_cost',        l.est_cost
                    )
                    ORDER BY l.item_type, l.shortage DESC
                  )
                  FROM lines l),
                 '[]'::jsonb
               ),
    'total_est_cost', COALESCE((SELECT SUM(l.est_cost) FROM lines l), 0),
    'shortage_count', COALESCE((SELECT COUNT(*) FROM lines l WHERE l.shortage > 0), 0)
  );
$fn$;

-- ---- 5. drop the now-unreferenced view ---------------------------------------
DROP VIEW IF EXISTS public.ppc_stock;

COMMIT;

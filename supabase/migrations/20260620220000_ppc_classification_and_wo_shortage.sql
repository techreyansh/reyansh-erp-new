-- PPC / Inventory: (1) ABC (by consumption value) + XYZ (by demand variability)
-- classification computed from the stock-transaction ledger; (2) per-work-order
-- kitting shortfall (required vs issued vs on-hand) so production sees what's short.
BEGIN;

ALTER TABLE public.ppc_stock ADD COLUMN IF NOT EXISTS abc_class char(1);
ALTER TABLE public.ppc_stock ADD COLUMN IF NOT EXISTS xyz_class char(1);

-- Recompute ABC/XYZ from the last 180d (value) / 365d (variability) of movements.
CREATE OR REPLACE FUNCTION public.ppc_recompute_classification()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  WITH consumption AS (
    SELECT t.item_id,
           sum(abs(t.quantity_delta)) FILTER (WHERE t.transaction_type IN ('issue','dispatch')) * COALESCE(i.unit_cost,0) AS value_out
    FROM public.ppc_stock_transactions t
    JOIN public.ppc_items i ON i.id = t.item_id
    WHERE t.created_at >= now() - interval '180 days'
    GROUP BY t.item_id, i.unit_cost
  ),
  ranked AS (
    SELECT item_id, value_out,
           sum(value_out) OVER () AS total_value,
           sum(value_out) OVER (ORDER BY value_out DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_value
    FROM consumption WHERE value_out > 0
  ),
  abc AS (
    SELECT item_id,
           CASE WHEN total_value = 0 THEN 'C'
                WHEN cum_value / total_value <= 0.80 THEN 'A'
                WHEN cum_value / total_value <= 0.95 THEN 'B'
                ELSE 'C' END AS abc
    FROM ranked
  ),
  monthly AS (
    SELECT item_id, date_trunc('month', created_at) AS mon,
           sum(abs(quantity_delta)) FILTER (WHERE transaction_type IN ('issue','dispatch')) AS qout
    FROM public.ppc_stock_transactions
    WHERE created_at >= now() - interval '365 days'
    GROUP BY item_id, date_trunc('month', created_at)
  ),
  xyz AS (
    SELECT item_id,
           CASE WHEN COALESCE(avg(qout),0) = 0 THEN 'Z'
                WHEN stddev_pop(qout) / nullif(avg(qout),0) < 0.5 THEN 'X'
                WHEN stddev_pop(qout) / nullif(avg(qout),0) < 1.0 THEN 'Y'
                ELSE 'Z' END AS xyz
    FROM monthly GROUP BY item_id
  )
  UPDATE public.ppc_stock s
     SET abc_class = abc.abc, xyz_class = COALESCE(xyz.xyz,'Z')
    FROM abc LEFT JOIN xyz ON xyz.item_id = abc.item_id
   WHERE s.item_id = abc.item_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Kitting shortfall for a work order: per component, required vs issued vs on-hand.
CREATE OR REPLACE FUNCTION public.ppc_wo_shortage(p_wo_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.shortfall DESC), '[]'::jsonb)
  FROM (
    SELECT m.item_id, i.code, i.name, i.uom,
           m.qty_required, m.qty_issued,
           COALESCE(s.on_hand, 0) AS on_hand,
           GREATEST(m.qty_required - COALESCE(m.qty_issued,0) - COALESCE(s.on_hand,0), 0) AS shortfall
    FROM public.ppc_wo_material m
    JOIN public.ppc_items i ON i.id = m.item_id
    LEFT JOIN public.ppc_stock s ON s.item_id = m.item_id
    WHERE m.work_order_id = p_wo_id
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.ppc_recompute_classification() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_wo_shortage(uuid) TO authenticated;

-- Monthly re-classification (idempotent schedule).
do $cron$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    if exists (select 1 from cron.job where jobname='ppc-recompute-classification') then
      perform cron.unschedule('ppc-recompute-classification');
    end if;
    perform cron.schedule('ppc-recompute-classification','30 19 1 * *','select public.ppc_recompute_classification();');
  end if;
end;
$cron$;

COMMIT;

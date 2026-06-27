-- ppc_stock retirement, Stage 1: move ABC/XYZ classification off ppc_stock onto
-- ppc_items (the item master). reorder_point/safety_stock/lead_time/location/etc.
-- already moved to ppc_items earlier; reserved already lives on inv_balance; only
-- abc_class/xyz_class were still ppc_stock-only. After this, ppc_recompute_
-- classification writes the master and listStock reads it, so ppc_stock has one
-- fewer reader/writer. (Stage 2 = redirect the 6 stock-write RPCs to inv_ledger
-- + replace ppc_stock with a view over ppc_items + inv_balance.)

BEGIN;

ALTER TABLE public.ppc_items ADD COLUMN IF NOT EXISTS abc_class char(1);
ALTER TABLE public.ppc_items ADD COLUMN IF NOT EXISTS xyz_class char(1);

-- Backfill the current classification from ppc_stock.
UPDATE public.ppc_items i
   SET abc_class = s.abc_class, xyz_class = s.xyz_class
  FROM public.ppc_stock s
 WHERE s.item_id = i.id;

-- Recompute now writes the item master instead of ppc_stock.
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
  UPDATE public.ppc_items i
     SET abc_class = abc.abc, xyz_class = COALESCE(xyz.xyz,'Z')
    FROM abc LEFT JOIN xyz ON xyz.item_id = abc.item_id
   WHERE i.id = abc.item_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ppc_recompute_classification() TO authenticated;

COMMIT;

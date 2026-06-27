-- ppc_stock_transactions → inv_ledger cutover: ABC/XYZ classification.
-- ppc_stock became a view (Stage 2), so its audit trigger is gone and
-- ppc_stock_transactions no longer gains rows. Recompute consumption from the
-- perpetual ledger instead. Outbound/demand movements = ISSUE / MFG_CONSUME /
-- DISPATCH (the inv_ledger equivalents of the legacy 'issue'/'dispatch'); exclude
-- TRANSFER_OUT and SCRAP. Same ABC (80/95 Pareto) + XYZ (CV) logic, still writing
-- ppc_items (Stage 1 target) and keeping the monthly cron.

CREATE OR REPLACE FUNCTION public.ppc_recompute_classification()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  WITH consumption AS (
    SELECT t.item_id,
           sum(abs(t.qty_delta)) FILTER (WHERE t.movement_type IN ('ISSUE','MFG_CONSUME','DISPATCH')) * COALESCE(i.unit_cost,0) AS value_out
    FROM public.inv_ledger t
    JOIN public.ppc_items i ON i.id = t.item_id
    WHERE t.posted_at >= now() - interval '180 days'
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
    SELECT item_id, date_trunc('month', posted_at) AS mon,
           sum(abs(qty_delta)) FILTER (WHERE movement_type IN ('ISSUE','MFG_CONSUME','DISPATCH')) AS qout
    FROM public.inv_ledger
    WHERE posted_at >= now() - interval '365 days'
    GROUP BY item_id, date_trunc('month', posted_at)
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

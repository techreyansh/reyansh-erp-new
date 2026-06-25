-- CRM: (1) clean the repeat-customer order-cycle stages — drop "Keep Informed"
-- and the separate "Invoicing" (invoicing now happens during Dispatch), add a
-- "Production / Batches" stage; (2) add a reorder/retention analytics RPC that
-- derives per-customer cadence, due/overdue, RFM-ish recency and a churn score
-- from order history (uses the reliable created_at, not the free-text date).
BEGIN;

-- 1) Migrate existing rows off the removed stages, then re-define the CHECK.
UPDATE public.crm_order_cycle SET cycle_stage = 'dispatch'
 WHERE cycle_stage IN ('keep_informed','invoicing');

ALTER TABLE public.crm_order_cycle DROP CONSTRAINT IF EXISTS crm_order_cycle_cycle_stage_check;
ALTER TABLE public.crm_order_cycle
  ADD CONSTRAINT crm_order_cycle_cycle_stage_check
  CHECK (cycle_stage IN ('order_taking','order_received','production','dispatch','payment_followup','closed'));

CREATE OR REPLACE FUNCTION public.crm_move_order_cycle(
  p_id uuid, p_to_stage text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_row public.crm_order_cycle%ROWTYPE;
BEGIN
  IF p_to_stage NOT IN ('order_taking','order_received','production','dispatch','payment_followup','closed') THEN
    RAISE EXCEPTION 'Invalid cycle stage: %', p_to_stage;
  END IF;
  UPDATE public.crm_order_cycle
     SET cycle_stage = p_to_stage,
         notes = CASE WHEN p_note IS NULL OR p_note = '' THEN notes
                      ELSE COALESCE(notes || E'\n', '') || p_note END
   WHERE id = p_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order cycle % not found', p_id; END IF;
  RETURN to_jsonb(v_row);
END;
$fn$;

-- 2) Reorder / retention analytics from order history.
CREATE OR REPLACE FUNCTION public.crm_customer_analytics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ord AS (
    SELECT
      lower(trim("ClientCode")) AS client_code,
      "OrderDate" AS odate,
      COALESCE("TotalAmount", 0) AS val
    FROM public.client_orders_data
    WHERE "ClientCode" IS NOT NULL AND trim("ClientCode") <> '' AND "OrderDate" IS NOT NULL
  ),
  gaps AS (
    SELECT client_code, odate, val,
           odate - lag(odate) OVER (PARTITION BY client_code ORDER BY odate) AS gap
    FROM ord
  ),
  agg AS (
    SELECT client_code,
           count(*) AS order_count,
           max(odate) AS last_order,
           min(odate) AS first_order,
           round(sum(val))::numeric AS total_value,
           round(sum(val) FILTER (WHERE odate >= current_date - 365))::numeric AS value_12mo,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) FILTER (WHERE gap IS NOT NULL))::numeric AS cadence_days
    FROM gaps GROUP BY client_code
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.churn_score DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT a.client_code, a.order_count, a.last_order, a.first_order,
           a.total_value, a.value_12mo, a.cadence_days,
           (current_date - a.last_order) AS recency_days,
           CASE WHEN a.cadence_days IS NOT NULL AND a.cadence_days > 0
                THEN (a.last_order + make_interval(days => round(a.cadence_days)::int))::date END AS next_expected,
           CASE
             WHEN a.cadence_days IS NULL OR a.order_count < 3 THEN 'new'
             WHEN (current_date - a.last_order) > a.cadence_days * 1.5 THEN 'overdue'
             WHEN (current_date - a.last_order) >= a.cadence_days THEN 'due'
             WHEN (current_date - a.last_order) >= a.cadence_days * 0.75 THEN 'due_soon'
             ELSE 'ok'
           END AS due_status,
           CASE WHEN a.cadence_days IS NOT NULL AND a.cadence_days > 0
                THEN least(100, greatest(0, round(((current_date - a.last_order)::numeric / a.cadence_days - 1) * 100)))
                END AS churn_score,
           coalesce(c.company_name, a.client_code) AS company_name,
           c.owner_email
    FROM agg a
    LEFT JOIN (
      SELECT DISTINCT ON (lower(trim(customer_code)))
             lower(trim(customer_code)) AS cc, company_name, owner_email
      FROM public.crm_order_cycle
      ORDER BY lower(trim(customer_code)), updated_at DESC
    ) c ON c.cc = a.client_code
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.crm_customer_analytics() TO authenticated;

COMMIT;

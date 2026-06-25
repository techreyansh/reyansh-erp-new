-- CRM dashboards: prospect funnel + client revenue/health aggregations over the
-- unified master (crm_pipeline) + AR (finance_invoices). Read-only RPCs.
BEGIN;

CREATE OR REPLACE FUNCTION public.crm_prospect_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (SELECT * FROM public.crm_pipeline WHERE account_type = 'prospect'),
       conv AS (SELECT count(*)::int n FROM public.crm_pipeline WHERE converted_at IS NOT NULL)
  SELECT jsonb_build_object(
    'total_prospects',  (SELECT count(*) FROM p),
    'new_this_month',   (SELECT count(*) FROM p WHERE created_at >= date_trunc('month', now())),
    'followups_due',    (SELECT count(*) FROM public.crm_pipeline_activity a JOIN p ON p.id = a.pipeline_id
                          WHERE a.status = 'open' AND a.next_follow_up_date IS NOT NULL AND a.next_follow_up_date <= current_date),
    'followups_open',   (SELECT count(*) FROM public.crm_pipeline_activity a JOIN p ON p.id = a.pipeline_id
                          WHERE a.status = 'open' AND a.next_follow_up_date IS NOT NULL),
    'pipeline_value',   (SELECT COALESCE(round(sum(COALESCE(expected_value, value, 0))),0) FROM p),
    'weighted_pipeline',(SELECT COALESCE(round(sum(COALESCE(expected_value, value, 0) * COALESCE(probability,0)/100.0)),0) FROM p),
    'converted',        (SELECT n FROM conv),
    'conversion_rate',  (SELECT CASE WHEN ((SELECT count(*) FROM p) + (SELECT n FROM conv)) = 0 THEN 0
                          ELSE round((SELECT n FROM conv)::numeric * 100 / ((SELECT count(*) FROM p) + (SELECT n FROM conv)), 1) END),
    'funnel',           (SELECT COALESCE(jsonb_object_agg(prospect_stage, n), '{}'::jsonb)
                          FROM (SELECT prospect_stage, count(*) n FROM p WHERE prospect_stage IS NOT NULL GROUP BY prospect_stage) s),
    'by_owner',         (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
                          FROM (SELECT COALESCE(owner_email,'(unassigned)') owner_email, count(*) n FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t)
  );
$$;
GRANT EXECUTE ON FUNCTION public.crm_prospect_dashboard() TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_client_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cl AS (SELECT * FROM public.crm_pipeline WHERE account_type = 'client')
  SELECT jsonb_build_object(
    'total_clients',  (SELECT count(*) FROM cl),
    'by_stage',       (SELECT COALESCE(jsonb_object_agg(COALESCE(client_stage,'active'), n), '{}'::jsonb)
                        FROM (SELECT client_stage, count(*) n FROM cl GROUP BY client_stage) s),
    'key_accounts',   (SELECT count(*) FROM cl WHERE client_stage = 'key_account'),
    'dormant',        (SELECT count(*) FROM cl WHERE client_stage = 'dormant'),
    'revenue_total',  (SELECT COALESCE(round(sum(COALESCE(total_value, value, 0))),0) FROM cl),
    'top_customers',  (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
                        FROM (SELECT company_name, customer_code, COALESCE(total_value, value, 0) AS revenue, owner_email
                              FROM cl ORDER BY COALESCE(total_value, value, 0) DESC NULLS LAST LIMIT 10) t),
    'outstanding',    (SELECT COALESCE(round(sum(balance)),0) FROM public.finance_invoices WHERE balance > 0),
    'overdue',        (SELECT COALESCE(round(sum(balance)),0) FROM public.v_ar_invoices WHERE ar_status = 'overdue')
  );
$$;
GRANT EXECUTE ON FUNCTION public.crm_client_dashboard() TO authenticated;

COMMIT;

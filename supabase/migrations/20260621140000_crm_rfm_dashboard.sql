-- CRM RFM & Retention dashboard aggregations over the unified client master.
-- RFM scores (1-5) per client: R from reorder recency-vs-cadence (due_status),
-- F from order_count bands, M from value quintile. Returns the segment summary,
-- a 5x5 R×F grid heatmap, and retention/health stats. Read-only RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.crm_rfm_dashboard(p_owner_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cl AS (
    SELECT p.id, lower(trim(coalesce(p.customer_code,''))) AS cc, p.company_name,
           p.owner_email, COALESCE(p.total_value, p.value, 0) AS monetary
    FROM public.crm_pipeline p
    WHERE p.account_type = 'client' AND COALESCE(p.is_active,true) = true
      AND (p_owner_email IS NULL OR lower(p.owner_email)=lower(p_owner_email) OR p.owner_email IS NULL)
  ),
  an AS (
    SELECT lower(trim(x->>'client_code')) AS cc,
           (x->>'order_count')::int AS order_count,
           (x->>'recency_days')::int AS recency_days,
           (x->>'cadence_days')::numeric AS cadence_days,
           (x->>'due_status') AS due_status,
           (x->>'churn_score')::numeric AS churn_score,
           (x->>'total_value')::numeric AS total_value,
           (x->>'value_12mo')::numeric AS value_12mo
    FROM jsonb_array_elements(public.crm_customer_analytics()) x
  ),
  base AS (
    SELECT cl.id, cl.company_name, cl.cc,
           COALESCE(an.order_count,0) AS order_count,
           an.recency_days, an.cadence_days,
           COALESCE(an.due_status,'new') AS due_status,
           an.churn_score,
           GREATEST(COALESCE(an.total_value,0), cl.monetary) AS monetary,
           COALESCE(an.value_12mo,0) AS value_12mo
    FROM cl LEFT JOIN an ON an.cc = cl.cc
  ),
  scored AS (
    SELECT b.*,
      CASE b.due_status WHEN 'ok' THEN 5 WHEN 'due_soon' THEN 4 WHEN 'new' THEN 3
           WHEN 'due' THEN 2 WHEN 'overdue' THEN 1 ELSE 3 END AS r_score,
      CASE WHEN b.order_count >= 10 THEN 5 WHEN b.order_count >= 6 THEN 4
           WHEN b.order_count >= 3 THEN 3 WHEN b.order_count >= 2 THEN 2 ELSE 1 END AS f_score,
      ntile(5) OVER (ORDER BY b.monetary NULLS FIRST) AS m_score
    FROM base b
  ),
  seg AS (
    SELECT s.*,
      CASE
        WHEN s.order_count < 3 THEN 'new'
        WHEN s.due_status='overdue' AND s.monetary >= 100000 THEN 'at_risk'
        WHEN s.due_status IN ('ok','due_soon') AND s.order_count >= 6 AND s.m_score >= 4 THEN 'champion'
        WHEN s.order_count >= 4 AND s.due_status <> 'overdue' THEN 'loyal'
        WHEN s.due_status='overdue' THEN 'hibernating'
        ELSE 'potential'
      END AS segment
    FROM scored s
  )
  SELECT jsonb_build_object(
    'total_clients', (SELECT count(*) FROM seg),
    'segments', (SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.total_value DESC NULLS LAST),'[]'::jsonb) FROM (
        SELECT segment,
               count(*)::int AS count,
               round(sum(monetary))::numeric AS total_value,
               round(avg(recency_days))::int AS avg_recency,
               round(avg(order_count),1) AS avg_frequency,
               round(avg(monetary))::numeric AS avg_value
        FROM seg GROUP BY segment) t),
    'grid', (SELECT COALESCE(jsonb_agg(row_to_json(g)),'[]'::jsonb) FROM (
        SELECT r_score, f_score, count(*)::int AS count, round(sum(monetary))::numeric AS value
        FROM seg GROUP BY r_score, f_score) g),
    'stats', (SELECT jsonb_build_object(
        'repeat_rate',       CASE WHEN count(*)>0 THEN round(count(*) FILTER (WHERE order_count>=2)::numeric*100/count(*),1) ELSE 0 END,
        'on_time_rate',      CASE WHEN count(*) FILTER (WHERE order_count>=1)>0
                                  THEN round(count(*) FILTER (WHERE due_status IN ('ok','due_soon'))::numeric*100/count(*) FILTER (WHERE order_count>=1),1) ELSE 0 END,
        'avg_cadence_days',  round(avg(cadence_days) FILTER (WHERE cadence_days IS NOT NULL)),
        'at_risk_value',     round(COALESCE(sum(value_12mo) FILTER (WHERE due_status='overdue'),0))::numeric,
        'with_orders',       count(*) FILTER (WHERE order_count>=1)::int,
        'champions_value_pct', CASE WHEN sum(monetary)>0
                                  THEN round(sum(monetary) FILTER (WHERE segment='champion')*100/sum(monetary),1) ELSE 0 END
      ) FROM seg)
  );
$$;
GRANT EXECUTE ON FUNCTION public.crm_rfm_dashboard(text) TO authenticated;

COMMIT;

-- Daily Worklist: surface ASSIGNED + COLLABORATED accounts, not just owned.
-- Before: crm_rep_worklist filtered by owner_email only, so an action assigned
-- to a rep (next_action_owner_email) or an account they collaborate on never
-- appeared in their worklist. Now the rep scope also includes those, tagged
-- with assignment_reason. Manager (p_owner_email IS NULL) path is unchanged.
-- Also: assigned/collaborated rows are no longer dropped by the priority>0
-- filter (a freshly-assigned task with a future date could score 0).
-- Additive: CREATE OR REPLACE, same signature; plus a one-time idempotent
-- backfill of collaborator rows for pre-existing action-owner assignments.
BEGIN;

CREATE OR REPLACE FUNCTION public.crm_rep_worklist(p_owner_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH acct AS (
    SELECT p.id, p.customer_code, lower(trim(coalesce(p.customer_code,''))) AS cc,
           p.company_name, p.owner_email, p.contact_person, p.phone, p.email,
           p.city, p.industry, p.product_category, p.client_stage,
           COALESCE(p.total_value, p.value, 0) AS monetary,
           p.last_contact_date, p.next_action, p.next_action_date,
           p.next_action_owner_email
    FROM public.crm_pipeline p
    WHERE p.account_type = 'client' AND COALESCE(p.is_active, true) = true
      AND (p_owner_email IS NULL
           OR lower(p.owner_email) = lower(p_owner_email)
           OR p.owner_email IS NULL
           OR lower(coalesce(p.next_action_owner_email,'')) = lower(p_owner_email)
           OR EXISTS (SELECT 1 FROM public.crm_pipeline_collaborators c
                      WHERE c.pipeline_id = p.id AND lower(c.email) = lower(p_owner_email)))
  ),
  an AS (
    SELECT lower(trim(x->>'client_code')) AS cc,
           (x->>'order_count')::int       AS order_count,
           (x->>'last_order')::date       AS last_order,
           (x->>'cadence_days')::numeric  AS cadence_days,
           (x->>'recency_days')::int      AS recency_days,
           NULLIF(x->>'next_expected','')::date AS next_expected,
           (x->>'due_status')             AS due_status,
           (x->>'churn_score')::numeric   AS churn_score,
           (x->>'total_value')::numeric   AS hist_value,
           (x->>'value_12mo')::numeric    AS value_12mo
    FROM jsonb_array_elements(public.crm_customer_analytics()) x
  ),
  ar AS (
    SELECT lower(trim(customer_code)) AS cc,
           round(sum(balance))::numeric AS overdue_balance,
           count(*)::int                AS overdue_count,
           max(days_past_due)::int      AS max_days_past_due
    FROM public.v_ar_invoices
    WHERE ar_status = 'overdue' AND balance > 0 AND customer_code IS NOT NULL
    GROUP BY 1
  ),
  fu AS (
    SELECT a.pipeline_id AS id,
           min(a.next_follow_up_date) AS next_followup,
           (array_agg(a.subject ORDER BY a.next_follow_up_date))[1] AS followup_subject
    FROM public.crm_pipeline_activity a
    WHERE a.status = 'open' AND a.next_follow_up_date IS NOT NULL
    GROUP BY a.pipeline_id
  ),
  rfm AS (
    SELECT acct.id,
           ntile(5) OVER (ORDER BY GREATEST(acct.monetary, COALESCE(an.hist_value,0)) NULLS FIRST) AS m_score,
           CASE WHEN an.order_count IS NULL THEN 1
                WHEN an.order_count >= 10 THEN 5 WHEN an.order_count >= 6 THEN 4
                WHEN an.order_count >= 3 THEN 3 WHEN an.order_count >= 2 THEN 2 ELSE 1 END AS f_score,
           CASE an.due_status WHEN 'ok' THEN 5 WHEN 'due_soon' THEN 4 WHEN 'new' THEN 3
                WHEN 'due' THEN 2 WHEN 'overdue' THEN 1 ELSE 3 END AS r_score
    FROM acct LEFT JOIN an ON an.cc = acct.cc
  ),
  joined AS (
    SELECT acct.id, acct.customer_code, acct.company_name, acct.owner_email,
           acct.contact_person, acct.phone, acct.email, acct.city, acct.industry,
           acct.product_category, acct.client_stage,
           GREATEST(acct.monetary, COALESCE(an.hist_value,0)) AS monetary,
           an.order_count, an.last_order, an.cadence_days, an.recency_days,
           an.next_expected, COALESCE(an.due_status,'new') AS due_status,
           an.churn_score, an.value_12mo,
           COALESCE(ar.overdue_balance,0) AS overdue_balance,
           COALESCE(ar.overdue_count,0)   AS overdue_count,
           COALESCE(ar.max_days_past_due,0) AS max_days_past_due,
           fu.followup_subject, acct.next_action, acct.next_action_date,
           acct.next_action_owner_email,
           LEAST(fu.next_followup, acct.next_action_date) AS eff_followup,
           (current_date - acct.last_contact_date) AS days_since_touch,
           rfm.r_score, rfm.f_score, rfm.m_score
    FROM acct
    LEFT JOIN an  ON an.cc = acct.cc
    LEFT JOIN ar  ON ar.cc = acct.cc
    LEFT JOIN fu  ON fu.id = acct.id
    LEFT JOIN rfm ON rfm.id = acct.id
  ),
  scored AS (
    SELECT j.*,
      CASE
        WHEN COALESCE(j.order_count,0) < 3 THEN 'new'
        WHEN j.due_status = 'overdue' AND j.monetary >= 100000 THEN 'at_risk'
        WHEN j.due_status IN ('ok','due_soon') AND COALESCE(j.order_count,0) >= 6 AND COALESCE(j.m_score,0) >= 4 THEN 'champion'
        WHEN COALESCE(j.order_count,0) >= 4 AND j.due_status <> 'overdue' THEN 'loyal'
        WHEN j.due_status = 'overdue' THEN 'hibernating'
        ELSE 'potential'
      END AS segment,
      ( CASE WHEN j.overdue_balance > 0 THEN least(40, 15 + j.max_days_past_due/3.0) ELSE 0 END
        + CASE WHEN j.due_status = 'overdue' THEN 25 + COALESCE(j.churn_score,0)*0.15
               WHEN j.due_status = 'due' THEN 15
               WHEN j.due_status = 'due_soon' THEN 8 ELSE 0 END
        + CASE WHEN j.eff_followup IS NOT NULL AND j.eff_followup <= current_date THEN 20
               WHEN j.eff_followup IS NOT NULL AND j.eff_followup <= current_date + 2 THEN 10 ELSE 0 END
        + CASE WHEN j.days_since_touch >= 60 THEN 8 WHEN j.days_since_touch >= 30 THEN 4 ELSE 0 END
      ) AS priority_raw
    FROM joined j
  )
  SELECT COALESCE(jsonb_agg(row_to_json(out) ORDER BY out.priority_score DESC, out.monetary DESC), '[]'::jsonb)
  FROM (
    SELECT s.id, s.customer_code, s.company_name, s.owner_email, s.contact_person,
           s.phone, s.email, s.city, s.industry, s.product_category, s.client_stage,
           s.monetary, s.order_count, s.last_order, s.cadence_days, s.recency_days,
           s.next_expected, s.due_status, s.churn_score, s.value_12mo,
           s.overdue_balance, s.overdue_count, s.max_days_past_due,
           s.eff_followup, s.followup_subject, s.next_action, s.next_action_date,
           s.next_action_owner_email, s.days_since_touch,
           s.r_score, s.f_score, s.m_score, s.segment,
           least(100, round(s.priority_raw))::int AS priority_score,
           CASE
             WHEN p_owner_email IS NULL THEN 'all'
             WHEN lower(coalesce(s.owner_email,'')) = lower(p_owner_email) THEN 'owner'
             WHEN lower(coalesce(s.next_action_owner_email,'')) = lower(p_owner_email) THEN 'action_owner'
             ELSE 'collaborator'
           END AS assignment_reason,
           (
             (CASE WHEN s.overdue_balance > 0 THEN jsonb_build_array(jsonb_build_object(
                'code','payment_overdue','label','Payment overdue',
                'detail', round(s.overdue_balance)::text||' across '||s.overdue_count||' invoice(s), '||s.max_days_past_due||'d past due')) ELSE '[]'::jsonb END)
             || (CASE
                   WHEN s.due_status = 'overdue' THEN jsonb_build_array(jsonb_build_object(
                     'code','reorder_overdue','label','Reorder overdue',
                     'detail','Expected ~'||COALESCE(s.next_expected::text,'?')||'; '||COALESCE(s.recency_days::text,'?')||'d since last order'))
                   WHEN s.due_status = 'due' THEN jsonb_build_array(jsonb_build_object(
                     'code','reorder_due','label','Reorder due',
                     'detail','Due now (cadence ~'||round(COALESCE(s.cadence_days,0))||'d)'))
                   WHEN s.due_status = 'due_soon' THEN jsonb_build_array(jsonb_build_object(
                     'code','reorder_due_soon','label','Reorder due soon','detail','Approaching reorder window'))
                   ELSE '[]'::jsonb END)
             || (CASE WHEN s.eff_followup IS NOT NULL AND s.eff_followup <= current_date THEN jsonb_build_array(jsonb_build_object(
                   'code','followup_due','label','Follow-up due',
                   'detail', COALESCE(s.followup_subject, s.next_action, 'Scheduled follow-up')||' ('||s.eff_followup::text||')')) ELSE '[]'::jsonb END)
             || (CASE WHEN s.days_since_touch >= 30 THEN jsonb_build_array(jsonb_build_object(
                   'code','no_touch','label','No recent contact','detail',s.days_since_touch||'d since last touch')) ELSE '[]'::jsonb END)
           ) AS reasons
    FROM scored s
  ) out
  -- keep zero-priority accounts ONLY when they are assigned to / shared with the
  -- scoped rep, so a freshly-assigned task is never silently hidden.
  WHERE out.priority_score > 0
     OR out.assignment_reason IN ('action_owner','collaborator');
$$;
GRANT EXECUTE ON FUNCTION public.crm_rep_worklist(text) TO authenticated;

-- One-time, idempotent backfill: existing action-owner assignments that predate
-- the auto-collaborate RPC get a collaborator row so they surface for the assignee.
INSERT INTO public.crm_pipeline_collaborators (pipeline_id, email, added_by_email)
SELECT p.id, lower(p.next_action_owner_email), 'system:backfill'
FROM public.crm_pipeline p
WHERE p.next_action_owner_email IS NOT NULL
  AND btrim(p.next_action_owner_email) <> ''
  AND lower(p.next_action_owner_email) <> lower(coalesce(p.owner_email,''))
ON CONFLICT (pipeline_id, lower(email)) DO NOTHING;

COMMIT;

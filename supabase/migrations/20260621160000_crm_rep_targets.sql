-- CRM Rep Targets + monthly Scorecard.
-- Managers set a monthly target per rep (revenue / new clients / orders);
-- the scorecard pulls ACTUALS from order history (client_orders_data joined to
-- the rep that owns the account in crm_pipeline) + conversions, and computes
-- achievement %. Self-contained: the only input is the targets the user enters.
BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_rep_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email        text NOT NULL,
  period_month       date NOT NULL,                 -- first day of the month
  target_value       numeric DEFAULT 0,             -- revenue target (INR)
  target_new_accounts int DEFAULT 0,                -- prospects converted to clients
  target_orders      int DEFAULT 0,
  notes              text,
  created_by         text,
  updated_at         timestamptz DEFAULT now(),
  created_at         timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_rep_targets_owner_month
  ON public.crm_rep_targets(lower(owner_email), period_month);

ALTER TABLE public.crm_rep_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_rep_targets_all ON public.crm_rep_targets;
CREATE POLICY crm_rep_targets_all ON public.crm_rep_targets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Upsert a target (one row per rep per month).
CREATE OR REPLACE FUNCTION public.crm_set_rep_target(
  p_owner_email text, p_month date, p_value numeric DEFAULT 0,
  p_new_accounts int DEFAULT 0, p_orders int DEFAULT 0, p_notes text DEFAULT NULL)
RETURNS public.crm_rep_targets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.crm_rep_targets; v_m date := date_trunc('month', p_month)::date;
BEGIN
  INSERT INTO public.crm_rep_targets(owner_email, period_month, target_value, target_new_accounts, target_orders, notes, created_by, updated_at)
  VALUES (lower(trim(p_owner_email)), v_m, COALESCE(p_value,0), COALESCE(p_new_accounts,0), COALESCE(p_orders,0), p_notes, rbac_current_email(), now())
  ON CONFLICT (lower(owner_email), period_month) DO UPDATE
    SET target_value = EXCLUDED.target_value,
        target_new_accounts = EXCLUDED.target_new_accounts,
        target_orders = EXCLUDED.target_orders,
        notes = EXCLUDED.notes,
        updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
GRANT EXECUTE ON FUNCTION public.crm_set_rep_target(text,date,numeric,int,int,text) TO authenticated;

-- Scorecard for a month: every assignable rep with target vs actual.
CREATE OR REPLACE FUNCTION public.crm_rep_scorecard(p_month date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH m AS (SELECT date_trunc('month', p_month)::date AS m0, (date_trunc('month', p_month) + interval '1 month')::date AS m1),
  reps AS (
    SELECT lower(u->>'email') AS email, (u->>'full_name') AS full_name,
           (u->>'department') AS department, (u->>'role') AS role
    FROM jsonb_array_elements(public.crm_assignable_users()) u
  ),
  rev AS (
    SELECT lower(trim(p.owner_email)) AS email,
           round(sum(o."TotalAmount"))::numeric AS actual_value,
           count(*)::int AS actual_orders
    FROM public.client_orders_data o
    JOIN public.crm_pipeline p ON lower(trim(p.customer_code)) = lower(trim(o."ClientCode"))
    , m
    WHERE o."OrderDate" >= m.m0 AND o."OrderDate" < m.m1 AND COALESCE(trim(p.owner_email),'') <> ''
    GROUP BY 1
  ),
  conv AS (
    SELECT lower(trim(owner_email)) AS email, count(*)::int AS actual_new_accounts
    FROM public.crm_pipeline p, m
    WHERE p.converted_at IS NOT NULL AND p.converted_at >= m.m0 AND p.converted_at < m.m1
      AND COALESCE(trim(p.owner_email),'') <> ''
    GROUP BY 1
  ),
  tgt AS (
    SELECT lower(owner_email) AS email, target_value, target_new_accounts, target_orders, notes
    FROM public.crm_rep_targets t, m WHERE t.period_month = m.m0
  )
  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.achievement_pct DESC NULLS LAST, s.target_value DESC), '[]'::jsonb)
  FROM (
    SELECT r.email, r.full_name, r.department, r.role,
           COALESCE(t.target_value,0) AS target_value,
           COALESCE(t.target_new_accounts,0) AS target_new_accounts,
           COALESCE(t.target_orders,0) AS target_orders,
           t.notes,
           COALESCE(rev.actual_value,0) AS actual_value,
           COALESCE(rev.actual_orders,0) AS actual_orders,
           COALESCE(conv.actual_new_accounts,0) AS actual_new_accounts,
           CASE WHEN COALESCE(t.target_value,0) > 0
                THEN round(COALESCE(rev.actual_value,0) * 100 / t.target_value, 1) END AS achievement_pct
    FROM reps r
    LEFT JOIN tgt t  ON t.email = r.email
    LEFT JOIN rev    ON rev.email = r.email
    LEFT JOIN conv   ON conv.email = r.email
  ) s;
$$;
GRANT EXECUTE ON FUNCTION public.crm_rep_scorecard(date) TO authenticated;

COMMIT;

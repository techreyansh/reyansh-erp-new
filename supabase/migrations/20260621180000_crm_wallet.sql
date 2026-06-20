-- CRM Share-of-Wallet.
-- Adds an editable per-account annual_potential (estimated total annual spend the
-- customer COULD give us). Share-of-wallet = our trailing-12-month value /
-- annual_potential. Surfaces capture rate + biggest untapped accounts. The only
-- input is the potential the user/rep enters per client.
BEGIN;

ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS annual_potential numeric;
COMMENT ON COLUMN public.crm_pipeline.annual_potential IS
  'Estimated total annual purchasing capacity (INR) of this account for our product range; basis for share-of-wallet.';

CREATE OR REPLACE FUNCTION public.crm_wallet_dashboard(p_owner_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cl AS (
    SELECT p.id, lower(trim(coalesce(p.customer_code,''))) AS cc, p.company_name,
           p.customer_code, p.owner_email, p.industry, p.city,
           p.annual_potential,
           GREATEST(COALESCE(p.total_value,0), COALESCE(p.value,0)) AS pipe_value
    FROM public.crm_pipeline p
    WHERE p.account_type = 'client' AND COALESCE(p.is_active,true) = true
      AND (p_owner_email IS NULL OR lower(p.owner_email)=lower(p_owner_email) OR p.owner_email IS NULL)
  ),
  an AS (
    SELECT lower(trim(x->>'client_code')) AS cc,
           (x->>'value_12mo')::numeric AS value_12mo,
           (x->>'total_value')::numeric AS total_value
    FROM jsonb_array_elements(public.crm_customer_analytics()) x
  ),
  j AS (
    SELECT cl.*,
           GREATEST(COALESCE(an.value_12mo,0), 0) AS value_12mo,
           GREATEST(COALESCE(an.total_value,0), cl.pipe_value) AS lifetime_value
    FROM cl LEFT JOIN an ON an.cc = cl.cc
  ),
  withpot AS (
    SELECT *, (annual_potential - value_12mo) AS untapped,
           CASE WHEN annual_potential > 0 THEN round(value_12mo*100/annual_potential,1) END AS capture_pct
    FROM j WHERE annual_potential IS NOT NULL AND annual_potential > 0
  )
  SELECT jsonb_build_object(
    'total_clients',          (SELECT count(*) FROM j),
    'accounts_with_potential',(SELECT count(*) FROM withpot),
    'total_potential',        (SELECT COALESCE(round(sum(annual_potential)),0) FROM withpot),
    'captured_value',         (SELECT COALESCE(round(sum(value_12mo)),0) FROM withpot),
    'capture_rate',           (SELECT CASE WHEN COALESCE(sum(annual_potential),0)>0
                                  THEN round(sum(value_12mo)*100/sum(annual_potential),1) ELSE 0 END FROM withpot),
    'total_untapped',         (SELECT COALESCE(round(sum(GREATEST(untapped,0))),0) FROM withpot),
    'top_untapped',           (SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.untapped DESC NULLS LAST), '[]'::jsonb)
                                FROM (SELECT company_name, customer_code, owner_email, industry, city,
                                             round(value_12mo) AS value_12mo, round(annual_potential) AS annual_potential,
                                             round(GREATEST(untapped,0)) AS untapped, capture_pct
                                      FROM withpot WHERE untapped > 0 ORDER BY untapped DESC LIMIT 15) t)
  );
$$;
GRANT EXECUTE ON FUNCTION public.crm_wallet_dashboard(text) TO authenticated;

COMMIT;

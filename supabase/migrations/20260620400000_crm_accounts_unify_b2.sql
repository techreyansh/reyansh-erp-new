-- PART B / Stage 2: enrich the master (crm_pipeline) with clients2's rich fields,
-- and normalize Contacts (jsonb) + address into the child tables. All 85 clients2
-- rows already exist in the master (matched by company name), so this is pure
-- enrichment — no new accounts. Idempotent (COALESCE / NOT EXISTS guards).
BEGIN;

-- 1) Enrich master fields (only where the master is still blank — CRM-entered data wins).
UPDATE public.crm_pipeline p SET
  gstin             = COALESCE(p.gstin, NULLIF(cl."GSTIN", '')),
  pan               = COALESCE(p.pan, NULLIF(cl."PANNumber", '')),
  business_type     = COALESCE(p.business_type, NULLIF(cl."BusinessType", '')),
  payment_terms     = COALESCE(p.payment_terms, NULLIF(cl."PaymentTerms", '')),
  credit_limit      = COALESCE(p.credit_limit, NULLIF(regexp_replace(COALESCE(cl."CreditLimit"::text,''), '[^0-9.]', '', 'g'), '')::numeric),
  credit_period     = COALESCE(p.credit_period, NULLIF(cl."CreditPeriod"::text, '')),
  delivery_terms    = COALESCE(p.delivery_terms, NULLIF(cl."DeliveryTerms", '')),
  website           = COALESCE(p.website, NULLIF(cl."Website", '')),
  rating            = COALESCE(p.rating, NULLIF(cl."Rating"::text, '')),
  total_orders      = COALESCE(p.total_orders, NULLIF(regexp_replace(COALESCE(cl."TotalOrders"::text,''), '[^0-9]', '', 'g'), '')::int),
  total_value       = COALESCE(p.total_value, NULLIF(regexp_replace(COALESCE(cl."TotalValue"::text,''), '[^0-9.]', '', 'g'), '')::numeric)
FROM public.clients2 cl
WHERE lower(trim(p.company_name)) = lower(trim(cl."ClientName"));

-- 2) Contact persons: explode clients2.Contacts (jsonb array) -> crm_account_contacts.
INSERT INTO public.crm_account_contacts (account_id, full_name, email, phone, department, designation, is_primary)
SELECT p.id, ct->>'name', NULLIF(trim(ct->>'email'),''), NULLIF(trim(ct->>'number'),''),
       NULLIF(ct->>'department',''), NULLIF(ct->>'designation',''), COALESCE((ct->>'isPrimary')::boolean, false)
FROM public.clients2 cl
JOIN public.crm_pipeline p ON lower(trim(p.company_name)) = lower(trim(cl."ClientName"))
CROSS JOIN LATERAL jsonb_array_elements(cl."Contacts") ct
WHERE jsonb_typeof(cl."Contacts") = 'array'
  AND COALESCE(ct->>'name','') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.crm_account_contacts ex
                  WHERE ex.account_id = p.id AND lower(ex.full_name) = lower(ct->>'name'));

-- Where no contact came across but the pipeline row has a contact_person, seed one.
INSERT INTO public.crm_account_contacts (account_id, full_name, phone, email, is_primary)
SELECT p.id, p.contact_person, p.phone, p.email, true
FROM public.crm_pipeline p
WHERE COALESCE(p.contact_person,'') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.crm_account_contacts ex WHERE ex.account_id = p.id);

-- 3) Billing address from clients2.
INSERT INTO public.crm_account_addresses (account_id, address_type, line1, city, state, state_code, pincode, country, gstin, is_default)
SELECT p.id, 'billing', NULLIF(cl."Address",''), NULLIF(cl."City",''), NULLIF(cl."State",''),
       NULLIF(cl."StateCode"::text,''), NULLIF(cl."PinCode"::text,''), NULLIF(cl."Country",''), NULLIF(cl."GSTIN",''), true
FROM public.clients2 cl
JOIN public.crm_pipeline p ON lower(trim(p.company_name)) = lower(trim(cl."ClientName"))
WHERE COALESCE(cl."Address", cl."City", '') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.crm_account_addresses ex WHERE ex.account_id = p.id AND ex.address_type = 'billing');

-- mark clients2 frozen (kept as backup; the master is now authoritative)
COMMENT ON TABLE public.clients2 IS 'DEPRECATED 2026-06-20: merged into crm_pipeline (the unified account master). Read-only backup; drop in a later cleanup migration.';

COMMIT;

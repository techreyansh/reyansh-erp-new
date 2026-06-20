-- Compat view so the legacy clientService (and its ~15 readers: dispatch/PO
-- dropdowns, dashboards, product/sales-flow) read CLIENT accounts from the
-- crm_pipeline master instead of the deprecated clients2 table — exposing the
-- SAME PascalCase column shape clients2 had, so getAllClients' existing mapping
-- works unchanged. Clients = account_type 'client'/'converted' (C* codes).
BEGIN;

CREATE OR REPLACE VIEW public.v_clients_compat WITH (security_invoker = true) AS
  SELECT
    p.id,
    p.company_name                                   AS "ClientName",
    p.customer_code                                  AS "ClientCode",
    COALESCE(p.business_type,'')                     AS "BusinessType",
    COALESCE(addr.line1,'')                          AS "Address",
    COALESCE(p.city, addr.city, '')                  AS "City",
    COALESCE(addr.state,'')                          AS "State",
    ''                                               AS "StateCode",
    COALESCE(addr.pincode,'')                        AS "Pincode",
    COALESCE(addr.country,'India')                   AS "Country",
    COALESCE(p.gstin, addr.gstin, '')                AS "GSTIN",
    COALESCE(p.pan,'')                               AS "PANNumber",
    COALESCE(p.customer_code,'')                     AS "AccountCode",
    COALESCE(p.website,'')                           AS "Website",
    COALESCE(ct.contacts, '[]'::jsonb)               AS "Contacts",
    COALESCE(p.payment_terms,'')                     AS "PaymentTerms",
    COALESCE(p.credit_limit::text,'')                AS "CreditLimit",
    COALESCE(p.credit_period,'')                     AS "CreditPeriod",
    COALESCE(p.delivery_terms,'')                    AS "DeliveryTerms",
    '[]'::jsonb                                      AS "Products",
    COALESCE(p.notes,'')                             AS "Notes",
    CASE COALESCE(p.client_stage,'active')
      WHEN 'inactive' THEN 'Inactive'
      WHEN 'dormant'  THEN 'Dormant'
      ELSE 'Active' END                              AS "Status",
    COALESCE(p.rating,'0')                           AS "Rating",
    COALESCE(p.last_contact_date::text,'')           AS "LastContactDate",
    COALESCE(p.total_orders,0)                       AS "TotalOrders",
    COALESCE(p.total_value,0)                        AS "TotalValue",
    p.industry                                       AS "Industry",
    p.owner_email                                    AS "OwnerEmail",
    p.client_stage                                   AS "ClientStage",
    p.created_at
  FROM public.crm_pipeline p
  LEFT JOIN LATERAL (
    SELECT a.line1, a.city, a.state, a.pincode, a.country, a.gstin
    FROM public.crm_account_addresses a
    WHERE a.account_id = p.id
    ORDER BY (a.address_type='billing') DESC, a.is_default DESC NULLS LAST
    LIMIT 1
  ) addr ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'name', c.full_name, 'email', c.email, 'number', c.phone,
      'department', c.department, 'designation', c.designation,
      'isPrimary', COALESCE(c.is_primary,false)) ORDER BY c.is_primary DESC NULLS LAST) AS contacts
    FROM public.crm_account_contacts c WHERE c.account_id = p.id
  ) ct ON true
  WHERE p.account_type IN ('client','converted');

GRANT SELECT ON public.v_clients_compat TO authenticated;

COMMIT;

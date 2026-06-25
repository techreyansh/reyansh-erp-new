-- CRM Company 360° redesign — P0 schema (additive, no backfill).
-- Expands the company master + contacts + addresses to a full CRM record.
-- Existing columns (industry, customer_category, website, gstin, pan, rating,
-- lead_source, payment_terms, credit_period, probability, expected_value,
-- expected_close_date, annual_potential, owner_email) are left as-is.

ALTER TABLE public.crm_pipeline
  ADD COLUMN IF NOT EXISTS legal_name           text,
  ADD COLUMN IF NOT EXISTS customer_type         text,   -- OEM/Distributor/Dealer/Exporter…
  ADD COLUMN IF NOT EXISTS cin                   text,
  ADD COLUMN IF NOT EXISTS iec                   text,   -- import/export code
  ADD COLUMN IF NOT EXISTS annual_turnover       numeric,
  ADD COLUMN IF NOT EXISTS num_employees         integer,
  ADD COLUMN IF NOT EXISTS company_description    text,
  ADD COLUMN IF NOT EXISTS products_manufactured  text,
  ADD COLUMN IF NOT EXISTS markets_served         text,
  ADD COLUMN IF NOT EXISTS existing_suppliers     text,
  ADD COLUMN IF NOT EXISTS territory              text,
  ADD COLUMN IF NOT EXISTS currency               text DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS preferred_comm         text,   -- phone/email/whatsapp
  ADD COLUMN IF NOT EXISTS tags                   text[],
  ADD COLUMN IF NOT EXISTS current_products       text,
  ADD COLUMN IF NOT EXISTS interested_products    text,
  ADD COLUMN IF NOT EXISTS monthly_consumption    text,
  ADD COLUMN IF NOT EXISTS competitors            text,
  ADD COLUMN IF NOT EXISTS last_meeting_date      date;

ALTER TABLE public.crm_account_contacts
  ADD COLUMN IF NOT EXISTS alt_phone          text,
  ADD COLUMN IF NOT EXISTS linkedin           text,
  ADD COLUMN IF NOT EXISTS birthday           date,
  ADD COLUMN IF NOT EXISTS is_decision_maker  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_comm     text;

-- Addresses: add a maps link + widen the type beyond billing/shipping.
ALTER TABLE public.crm_account_addresses
  ADD COLUMN IF NOT EXISTS maps_url text;
ALTER TABLE public.crm_account_addresses
  DROP CONSTRAINT IF EXISTS crm_account_addresses_address_type_check;
ALTER TABLE public.crm_account_addresses
  ADD CONSTRAINT crm_account_addresses_address_type_check
  CHECK (address_type IN ('registered','corporate','factory','warehouse','billing','shipping'));

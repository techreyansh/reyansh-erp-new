-- =============================================================================
-- PPC ↔ ERP Integration — ERP side
-- Implements the ERP's half of "PPC ↔ ERP Integration Spec v1.0".
--
-- This ERP is the AUTHORITATIVE system for masters (Customer, Item, Supplier)
-- which PPC pulls via GET /customers|items|suppliers?since=, and the RECEIVING
-- system for transactional documents PPC posts on production events
-- (POST /invoices, /purchase-orders, /stock-journals).
--
-- This migration adds:
--   1. updated_at columns + triggers on the legacy master tables so PPC can do
--      delta ("?since=") sync against clients2 / vendors_data (products already
--      has updated_at).
--   2. sync_log / sync_state / sync_idempotency — cross-system audit + retry-safe
--      idempotency infrastructure (spec §6).
--   3. ppc_invoices / ppc_purchase_orders / ppc_stock_journals — durable inbound
--      document store for PPC-originated postings, kept separate from the CRM
--      finance tables (which carry strict FKs) so external postings can never
--      violate ERP-internal invariants. Stock journals ALSO post to real
--      inventory via update_inventory_transaction().
--
-- All statements are idempotent (safe to re-run).
-- =============================================================================

-- Shared updated_at trigger fn (already exists in schema.sql; redefine to be self-contained).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Delta-sync columns on legacy master tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.clients2     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.vendors_data ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill so the first delta pull (?since=<old ts>) returns existing rows once.
UPDATE public.clients2     SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;
UPDATE public.vendors_data SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS clients2_set_updated_at ON public.clients2;
CREATE TRIGGER clients2_set_updated_at
  BEFORE UPDATE ON public.clients2
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS vendors_data_set_updated_at ON public.vendors_data;
CREATE TRIGGER vendors_data_set_updated_at
  BEFORE UPDATE ON public.vendors_data
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS ix_clients2_updated_at     ON public.clients2 (updated_at);
CREATE INDEX IF NOT EXISTS ix_vendors_data_updated_at ON public.vendors_data (updated_at);

-- -----------------------------------------------------------------------------
-- 2. Sync infrastructure (spec §6)
-- -----------------------------------------------------------------------------

-- 2.1 sync_log — every cross-system call recorded (spec §6.2)
CREATE TABLE IF NOT EXISTS public.sync_log (
  id              BIGSERIAL PRIMARY KEY,
  job_id          UUID,
  direction       VARCHAR(10) NOT NULL,        -- 'inbound' | 'outbound'
  entity          VARCHAR(40) NOT NULL,        -- 'customer','item','supplier','invoice','po','grn','stock_issue','fg_receipt','health'
  ppc_ref         VARCHAR(80),
  erp_ref         VARCHAR(80),
  request_body    JSONB,
  response_body   JSONB,
  http_status     INT,
  status          VARCHAR(20) NOT NULL,        -- 'success'|'failure'|'retry'|'dead_letter'
  attempt         INT DEFAULT 1,
  idempotency_key TEXT,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sync_log_entity_status ON public.sync_log (entity, status);
CREATE INDEX IF NOT EXISTS ix_sync_log_created_at    ON public.sync_log (created_at DESC);

-- 2.2 sync_state — last-sync watermarks per entity (spec §6.3)
CREATE TABLE IF NOT EXISTS public.sync_state (
  entity          VARCHAR(40) PRIMARY KEY,
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_job_id     UUID,
  total_records   BIGINT DEFAULT 0
);

-- 2.3 sync_idempotency — retry-safe store: same Idempotency-Key returns the same
--     stored response without re-applying the side effect (spec §4.2.3, §6.4).
CREATE TABLE IF NOT EXISTS public.sync_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  entity          VARCHAR(40) NOT NULL,
  ppc_ref         VARCHAR(80),
  response_body   JSONB,
  http_status     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Inbound document store (PPC → ERP postings)
-- -----------------------------------------------------------------------------

-- 3.1 ppc_invoices — Invoice created from a PPC dispatch (spec §3.2.3, §4.2.2)
CREATE TABLE IF NOT EXISTS public.ppc_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_invoice_no  VARCHAR(40) UNIQUE NOT NULL,   -- ERP-generated, returned to PPC
  ppc_so          VARCHAR(40) NOT NULL,          -- PPC sales-order ref
  customer_code   VARCHAR(40),
  customer_id     UUID,                           -- resolved clients2.id when found
  invoice_date    DATE NOT NULL,
  vehicle_no      VARCHAR(40),
  lr_no           VARCHAR(40),
  remarks         TEXT,
  lines           JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ppc_invoices_so ON public.ppc_invoices (ppc_so);

-- 3.2 ppc_purchase_orders — PO created from a PPC indent (spec §3.2.4)
CREATE TABLE IF NOT EXISTS public.ppc_purchase_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_po_no        VARCHAR(40) UNIQUE NOT NULL,  -- ERP-generated, returned to PPC
  ppc_indent_no    VARCHAR(40) NOT NULL,
  supplier_code    VARCHAR(40),
  supplier_id      UUID,                          -- resolved vendors_data.id when found
  po_date          DATE NOT NULL,
  required_by      DATE,
  lines            JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ppc_po_indent ON public.ppc_purchase_orders (ppc_indent_no);

-- 3.3 ppc_stock_journals — Stock voucher header (Issue / GRN / FG Receipt).
--     Lines are also applied to real inventory via update_inventory_transaction().
CREATE TABLE IF NOT EXISTS public.ppc_stock_journals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_voucher_no   VARCHAR(40) UNIQUE NOT NULL,  -- ERP-generated
  voucher_type     VARCHAR(20) NOT NULL,         -- 'Stock Issue' | 'GRN' | 'FG Receipt'
  voucher_date     DATE NOT NULL,
  ppc_ref          VARCHAR(40) NOT NULL,
  supplier_code    VARCHAR(40),
  po_no            VARCHAR(40),
  lines            JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_lines    INT NOT NULL DEFAULT 0,        -- how many lines hit inventory
  skipped_lines    INT NOT NULL DEFAULT 0,        -- lines whose item/branch was unresolved
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ppc_stock_journals_ref ON public.ppc_stock_journals (ppc_ref);

-- -----------------------------------------------------------------------------
-- 4. RLS — enable + permissive policies (consistent with the rest of the app,
--    which enforces authorization at the app layer via get_my_rbac_access).
--    The Edge Function writes with the service role and bypasses RLS entirely;
--    these policies only govern the in-app read views of the sync data.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sync_log','sync_state','sync_idempotency',
    'ppc_invoices','ppc_purchase_orders','ppc_stock_journals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "ppc_all_%1$s" ON public.%1$I;', t);
    EXECUTE format('CREATE POLICY "ppc_all_%1$s" ON public.%1$I FOR ALL USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;

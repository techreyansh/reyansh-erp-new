-- Sync API support tables for the Cable Planner ↔ ERP integration.
-- Additive only — does NOT touch core ERP tables. The standalone Node sync
-- service connects via the Postgres connection string (bypasses RLS); these
-- tables back its auth, idempotency, audit, and material-key resolution.
-- Idempotent.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Devices that hold an API key (e.g. "Plant supervisor laptop").
CREATE TABLE IF NOT EXISTS public.sync_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-device API keys. Only the sha256 hash is stored; show the raw key once.
CREATE TABLE IF NOT EXISTS public.sync_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    uuid REFERENCES public.sync_devices(id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,
  scopes       text[] NOT NULL DEFAULT ARRAY[
                 'items.read','customers.read','sales-orders.read',
                 'sales-orders.status.write','production.write','consumption.write',
                 'stock.read','health.read'],
  is_active    boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_api_keys_device ON public.sync_api_keys(device_id);

-- Idempotency replay store (keys are globally-unique uuids from the planner).
CREATE TABLE IF NOT EXISTS public.sync_idempotency (
  key         text PRIMARY KEY,
  device_id   uuid,
  status_code integer NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_idempotency_created ON public.sync_idempotency(created_at);

-- Mutation audit trail (spec §7.4). Retained per GST policy on the ERP side.
CREATE TABLE IF NOT EXISTS public.sync_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid,
  action          text NOT NULL,
  entity          text,
  entity_id       text,
  before          jsonb,
  after           jsonb,
  idempotency_key text,
  ip              text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_audit_occurred ON public.sync_audit_log(occurred_at DESC);

-- Resolves the planner's structured material keys to real inventory products.
-- e.g. ('COPPER','0.20mm') -> the copper-RM product the inventory module uses.
CREATE TABLE IF NOT EXISTS public.sync_material_map (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_key text NOT NULL,                 -- COPPER | PVC_INS | PVC_SH
  sub_key      text NOT NULL DEFAULT '',      -- gauge / colour / 'natural'
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_key, sub_key)
);

-- RLS: the Node service bypasses RLS via the service connection. Expose admin
-- management to the ERP app (same helper used across the ERP).
ALTER TABLE public.sync_devices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_api_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_material_map  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_audit_log     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sync_devices','sync_api_keys','sync_material_map','sync_audit_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_admin ON public.%I;', t, t);
    -- current_user_is_admin() ships with the CRM/PPC migration.
    EXECUTE format($p$
      CREATE POLICY %I_admin ON public.%I FOR ALL TO authenticated
      USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());
    $p$, t, t);
  END LOOP;
END $$;

COMMIT;

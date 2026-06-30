-- =============================================================================
-- Order-to-Dispatch Workflow Engine — Phase 0 schema (additive, engine-owned)
-- =============================================================================
-- One customer Sales Order becomes one digital workflow (wf_instance) whose
-- stages (wf_stage_run) auto-advance by WATCHING existing status columns
-- (sales_order / ppc_wo / dispatch_plan / ppc_wo_material) and auto-spawn
-- department tasks into public.tasks. The engine ORCHESTRATES; it owns no
-- quantities and no cycle-times. It never alters MES/inventory tables or RPCs.
--
-- This migration is purely additive: new wf_* tables + one nullable FK column
-- on public.tasks. Nothing existing is modified. RPCs live in the companion
-- migration 20260701100100_o2d_workflow_engine_rpcs.sql.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1) wf_stage_def — stage catalogue (config-as-data). One row per stage per
--    order-type variant. Seeded below; editable later.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wf_stage_def (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_key       text NOT NULL,
  order_type      text NOT NULL DEFAULT 'ALL'
                    CHECK (order_type IN ('ALL','CABLE_ONLY','POWER_CORD')),
  sequence        int  NOT NULL,
  label           text NOT NULL,
  owner_role_code text,
  department      text,
  watch_signal    text NOT NULL DEFAULT 'manual'
                    CHECK (watch_signal IN (
                      'so_status','dispatch_status','kit_issued',
                      'wo_status_done','wo_status_qc','fg_stocked','manual')),
  watch_param     jsonb NOT NULL DEFAULT '{}'::jsonb,
  actuator_rpc    text,
  actuator_kind   text NOT NULL DEFAULT 'none'
                    CHECK (actuator_kind IN ('none','create_wo','issue_kit','so_transition','dispatch')),
  checklist       jsonb NOT NULL DEFAULT '[]'::jsonb,
  sla_days        int,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_key, order_type)
);

-- -----------------------------------------------------------------------------
-- 2) wf_stage_dep — predecessor edges (the dependency / gating primitive).
--    A stage cannot start until every predecessor (for this order_type) is done.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wf_stage_dep (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_key   text NOT NULL,
  order_type  text NOT NULL DEFAULT 'ALL'
                CHECK (order_type IN ('ALL','CABLE_ONLY','POWER_CORD')),
  depends_on  text NOT NULL,
  UNIQUE (stage_key, order_type, depends_on)
);

-- -----------------------------------------------------------------------------
-- 3) wf_instance — one workflow per sales order (the spine head).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wf_instance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id  uuid NOT NULL REFERENCES public.sales_order(id) ON DELETE CASCADE,
  so_number       text,
  order_type      text NOT NULL DEFAULT 'POWER_CORD'
                    CHECK (order_type IN ('CABLE_ONLY','POWER_CORD')),
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','blocked','completed','cancelled')),
  current_stage   text,
  customer_code   text,
  company_name    text,
  owner_email     text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_order_id)            -- one workflow per SO (idempotency anchor)
);

-- -----------------------------------------------------------------------------
-- 4) wf_stage_run — one row per stage per instance (the spine cells).
--    Lifecycle authority lives here; tasks.task_status is the human mirror.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wf_stage_run (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id     uuid NOT NULL REFERENCES public.wf_instance(id) ON DELETE CASCADE,
  stage_key       text NOT NULL,
  sequence        int  NOT NULL,
  label           text,
  department      text,
  owner_role_code text,
  status          text NOT NULL DEFAULT 'blocked'
                    CHECK (status IN ('blocked','ready','in_progress','done','skipped','cancelled')),
  task_id         uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  watch_signal    text,
  watch_param     jsonb DEFAULT '{}'::jsonb,
  actuator_rpc    text,
  actuator_kind   text,
  watch_satisfied boolean NOT NULL DEFAULT false,
  due_date        date,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, stage_key)    -- anti-double-spawn anchor
);

-- -----------------------------------------------------------------------------
-- 5) wf_wo_link — correlation spine. Closes the structural gap that ppc_wo has
--    no FK back to the order. Written by the engine when it triggers an actuator
--    (it is the caller, so it knows both order-side and WO-side).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wf_wo_link (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_run_id  uuid NOT NULL REFERENCES public.wf_stage_run(id) ON DELETE CASCADE,
  instance_id   uuid NOT NULL REFERENCES public.wf_instance(id) ON DELETE CASCADE,
  demand_id     uuid REFERENCES public.production_demand(id) ON DELETE SET NULL,
  plan_id       uuid,                 -- daily/cable plan id (loose; no FK to avoid MES coupling)
  wo_id         uuid REFERENCES public.ppc_wo(id) ON DELETE SET NULL,
  link_kind     text CHECK (link_kind IN ('ppc','cable')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_run_id, wo_id)
);

-- -----------------------------------------------------------------------------
-- 6) wf_event — per-order milestone timeline (and source for customer comms).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wf_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid NOT NULL REFERENCES public.wf_instance(id) ON DELETE CASCADE,
  stage_key     text,
  event_type    text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_email   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 7) wf_dirty — doorbell queue (Phase 2). Created now so the Phase 2 trigger on
--    ppc_wo / dispatch_plan just enqueues; cron drains it via wf_reconcile.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wf_dirty (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid REFERENCES public.wf_instance(id) ON DELETE CASCADE,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 8) tasks linkage — additive nullable FK (mirrors tasks.account_id pattern).
-- -----------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS stage_run_id uuid REFERENCES public.wf_stage_run(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_stage_run
  ON public.tasks(stage_run_id) WHERE stage_run_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wf_instance_so       ON public.wf_instance(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_wf_instance_status   ON public.wf_instance(status);
CREATE INDEX IF NOT EXISTS idx_wf_stage_run_inst    ON public.wf_stage_run(instance_id);
CREATE INDEX IF NOT EXISTS idx_wf_stage_run_status  ON public.wf_stage_run(status);
CREATE INDEX IF NOT EXISTS idx_wf_wo_link_inst      ON public.wf_wo_link(instance_id);
CREATE INDEX IF NOT EXISTS idx_wf_wo_link_wo        ON public.wf_wo_link(wo_id);
CREATE INDEX IF NOT EXISTS idx_wf_event_inst        ON public.wf_event(instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_dirty_inst        ON public.wf_dirty(instance_id);

-- -----------------------------------------------------------------------------
-- updated_at touch triggers (reuse public.touch_updated_at from the task system)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_wf_stage_def_touch ON public.wf_stage_def;
CREATE TRIGGER trg_wf_stage_def_touch BEFORE UPDATE ON public.wf_stage_def
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_wf_instance_touch ON public.wf_instance;
CREATE TRIGGER trg_wf_instance_touch BEFORE UPDATE ON public.wf_instance
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_wf_stage_run_touch ON public.wf_stage_run;
CREATE TRIGGER trg_wf_stage_run_touch BEFORE UPDATE ON public.wf_stage_run
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — read-open to authenticated (dashboards/control tower read across orders);
-- all writes flow through SECURITY DEFINER RPCs (companion migration) which
-- bypass RLS, plus an admin_all escape hatch for manual config edits.
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_stage_def  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_stage_dep  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_instance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_stage_run  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_wo_link    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_event      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_dirty      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wf_stage_def','wf_stage_dep','wf_instance','wf_stage_run','wf_wo_link','wf_event','wf_dirty']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_select_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);', t||'_select_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.current_user_is_admin_fallback()) WITH CHECK (public.current_user_is_admin_fallback());',
      t||'_admin_all', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated;', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- SEED: stage catalogue (wf_stage_def)
--   Order-level master chain. Phase-1 thin slice drives the 'ALL' stages
--   end-to-end; assembly/molding are POWER_CORD-only.
-- -----------------------------------------------------------------------------
INSERT INTO public.wf_stage_def
  (stage_key, order_type, sequence, label, department, owner_role_code, watch_signal, watch_param, actuator_rpc, actuator_kind, checklist, sla_days)
VALUES
  ('sales_order',        'ALL',        10,  'Sales Order',          'CRM',        NULL, 'so_status',       '{"status":"released"}'::jsonb,                NULL,                       'none',          '[]'::jsonb, 0),
  ('dispatch_planning',  'ALL',        20,  'Dispatch Planning',    'Dispatch',   NULL, 'dispatch_status', '{"status":"planned","mode":"exists"}'::jsonb, NULL,                       'dispatch',      '["Create dispatch plan","Set committed dispatch date"]'::jsonb, 1),
  ('production_planning','ALL',        30,  'Production Planning',   'PPC',        NULL, 'manual',          '{}'::jsonb,                                   'mes_release_plan_to_floor','create_wo',     '["Confirm production plan","Release plan to floor (creates Work Order)"]'::jsonb, 1),
  ('store_issue',        'ALL',        40,  'Store Material Issue',  'Production', NULL, 'kit_issued',      '{}'::jsonb,                                   'inv_issue_kit',            'issue_kit',     '["Verify RM availability","Issue copper","Issue PVC","Issue components","Confirm kit issued in ERP"]'::jsonb, 1),
  ('cable',              'ALL',        50,  'Cable Production',      'Production', NULL, 'wo_status_done',  '{}'::jsonb,                                   NULL,                       'none',          '["Run cable production","Close cable job"]'::jsonb, 2),
  ('assembly',           'POWER_CORD', 60,  'Assembly',             'Production', NULL, 'wo_status_done',  '{}'::jsonb,                                   NULL,                       'create_wo',     '["Verify cable available","Complete assembly","Quality check"]'::jsonb, 1),
  ('molding',            'POWER_CORD', 70,  'Molding',              'Production', NULL, 'wo_status_done',  '{}'::jsonb,                                   NULL,                       'create_wo',     '["Setup mold","Run molding","Close molding job"]'::jsonb, 1),
  ('packing',            'ALL',        80,  'Packing',              'Dispatch',   NULL, 'wo_status_qc',    '{}'::jsonb,                                   'ppc_record_qc',            'none',          '["HV test","Visual inspection","Pack per instructions"]'::jsonb, 1),
  ('fg',                 'ALL',        90,  'Finished Goods',       'Production', NULL, 'fg_stocked',      '{}'::jsonb,                                   'cable_finish_work_order',  'none',          '["Stock FG","Confirm ready for dispatch"]'::jsonb, 1),
  ('dispatch',           'ALL',        100, 'Dispatch',             'Dispatch',   NULL, 'dispatch_status', '{"status":"dispatched","mode":"equals"}'::jsonb, NULL,                    'dispatch',      '["Generate invoice","Record LR / courier","Confirm dispatch"]'::jsonb, 0),
  ('closure',            'ALL',        110, 'Order Closure',        'CRM',        NULL, 'manual',          '{}'::jsonb,                                   NULL,                       'so_transition', '["Confirm delivery","Close sales order"]'::jsonb, 0)
ON CONFLICT (stage_key, order_type) DO NOTHING;

-- -----------------------------------------------------------------------------
-- SEED: dependency edges (wf_stage_dep). order_type 'ALL' applies to both;
--   POWER_CORD / CABLE_ONLY rows encode the branch differences for packing.
-- -----------------------------------------------------------------------------
INSERT INTO public.wf_stage_dep (stage_key, order_type, depends_on) VALUES
  ('dispatch_planning',  'ALL',        'sales_order'),
  ('production_planning','ALL',        'sales_order'),
  ('store_issue',        'ALL',        'production_planning'),
  ('cable',              'ALL',        'store_issue'),
  ('assembly',           'POWER_CORD', 'cable'),
  ('molding',            'POWER_CORD', 'assembly'),
  ('packing',            'POWER_CORD', 'molding'),
  ('packing',            'CABLE_ONLY', 'cable'),
  ('fg',                 'ALL',        'packing'),
  ('dispatch',           'ALL',        'fg'),
  ('closure',            'ALL',        'dispatch')
ON CONFLICT (stage_key, order_type, depends_on) DO NOTHING;

COMMIT;

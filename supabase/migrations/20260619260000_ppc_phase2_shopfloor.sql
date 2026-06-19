-- =====================================================================
-- 20260619260000_ppc_phase2_shopfloor.sql
-- PPC (Production Planning & Control) PHASE 2 - SHOP FLOOR EXECUTION
--
-- Purpose
--   Builds the execution layer on top of the Phase-1 master/planning
--   foundation (ppc_items, ppc_bom, ppc_stock, ppc_lines, ppc_machines):
--     * ppc_wo          - work order (a job: make item X, qty Q, on a line)
--     * ppc_wo_stage    - routing stage of a WO, carrying the 4 M's:
--                           Machine  -> machine_id
--                           Man      -> operator_name
--                           Method   -> method_sheet
--                           Material -> (issued via ppc_wo_material)
--     * ppc_wo_material - material kitting / issue against a WO (consumes stock)
--     * ppc_wo_qc       - QC gate checks (per WO and/or per stage)
--   plus the shop-floor RPCs that drive them:
--     * ppc_create_work_order(...)  - create WO + routing + material kit
--     * ppc_issue_material(...)     - issue kit, decrement ppc_stock.on_hand
--     * ppc_advance_stage(...)      - move a stage, roll up WO status
--     * ppc_record_qc(...)          - log a QC check, optionally close WO
--     * ppc_shopfloor(...)          - board snapshot (WOs + stages)
--
-- Naming
--   Deliberately uses NEW table names with the `ppc_wo*` prefix so they do
--   NOT collide with the existing/legacy mock tables:
--     ppc_items, ppc_bom, ppc_stock, ppc_lines, ppc_machines,
--     ppc_work_orders (old/mock), ppc_qc_reports (old), ppc_bom_items,
--     ppc_material_consumption.
--
-- Security model
--   Internal module, gated in the app by RBAC role. At the DB level: RLS
--   enabled with a permissive policy for `authenticated` (USING true /
--   WITH CHECK true). RPCs are SECURITY DEFINER and stamp the actor via
--   public.rbac_current_email(). public.is_super_admin() is available to
--   callers but not required by these permissive policies.
--
-- Idempotency
--   Fully re-runnable: IF NOT EXISTS / CREATE OR REPLACE / guarded DO blocks
--   / DROP POLICY IF EXISTS before CREATE POLICY. Wrapped in one BEGIN/COMMIT.
--
-- NOTE: This migration is authored only. It is NOT executed here.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) ppc_wo - work order (the job)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_wo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_number      text UNIQUE,
  item_id        uuid NOT NULL REFERENCES public.ppc_items(id),
  qty            numeric NOT NULL DEFAULT 1,
  line_id        uuid REFERENCES public.ppc_lines(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','released','in_progress','qc','done','cancelled')),
  priority       text DEFAULT 'medium',
  planned_start  date,
  planned_end    date,
  due_date       date,
  produced_qty   numeric DEFAULT 0,
  scrap_qty      numeric DEFAULT 0,
  owner_email    text,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_wo_status  ON public.ppc_wo (status);
CREATE INDEX IF NOT EXISTS idx_ppc_wo_line_id ON public.ppc_wo (line_id);
CREATE INDEX IF NOT EXISTS idx_ppc_wo_item_id ON public.ppc_wo (item_id);

-- ---------------------------------------------------------------------
-- 2) ppc_wo_stage - routing stage (carries the 4 M's)
--      Machine  = machine_id, Man = operator_name, Method = method_sheet,
--      Material = issued separately via ppc_wo_material.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_wo_stage (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id  uuid NOT NULL REFERENCES public.ppc_wo(id) ON DELETE CASCADE,
  stage_name     text NOT NULL,
  sequence       int NOT NULL DEFAULT 0,
  machine_id     uuid REFERENCES public.ppc_machines(id) ON DELETE SET NULL,
  operator_name  text,
  method_sheet   text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','done','blocked')),
  output_qty     numeric DEFAULT 0,
  scrap_qty      numeric DEFAULT 0,
  started_at     timestamptz,
  completed_at   timestamptz,
  notes          text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_wo_stage_wo_seq
  ON public.ppc_wo_stage (work_order_id, sequence);

-- ---------------------------------------------------------------------
-- 3) ppc_wo_material - material kitting / issue against a WO
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_wo_material (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id    uuid NOT NULL REFERENCES public.ppc_wo(id) ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES public.ppc_items(id),
  qty_required     numeric DEFAULT 0,
  qty_issued       numeric DEFAULT 0,
  issued_by_email  text,
  issued_at        timestamptz,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_wo_material_wo
  ON public.ppc_wo_material (work_order_id);

-- ---------------------------------------------------------------------
-- 4) ppc_wo_qc - QC gate checks
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_wo_qc (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id    uuid NOT NULL REFERENCES public.ppc_wo(id) ON DELETE CASCADE,
  stage_id         uuid REFERENCES public.ppc_wo_stage(id) ON DELETE SET NULL,
  check_type       text NOT NULL,
  result           text NOT NULL DEFAULT 'pending'
                     CHECK (result IN ('pending','pass','fail')),
  measured_value   text,
  checked_by_email text,
  checked_at       timestamptz,
  notes            text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_wo_qc_wo
  ON public.ppc_wo_qc (work_order_id);

-- ---------------------------------------------------------------------
-- 5) Row Level Security + grants
--    Internal module: permissive policy for `authenticated`.
--    Guarded DO block so policy creation is idempotent.
-- ---------------------------------------------------------------------
ALTER TABLE public.ppc_wo          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppc_wo_stage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppc_wo_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppc_wo_qc       ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_wo          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_wo_stage    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_wo_material TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_wo_qc       TO authenticated;

DO $rls$
DECLARE
  t   text;
  pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ppc_wo','ppc_wo_stage','ppc_wo_material','ppc_wo_qc'
  ]
  LOOP
    pol := t || '_all';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      pol, t
    );
  END LOOP;
END
$rls$;

-- ---------------------------------------------------------------------
-- 6) RPC - public.ppc_create_work_order(...)
--      Creates a WO, its routing stages, and pre-populates the material
--      kit from the DIRECT BOM components of the item.
--
--    wo_number = 'WO-' || YYMMDD || '-' || zero-padded daily sequence.
--    Routing : caller-supplied p_stages (in order) OR a sensible default
--              set keyed off ppc_items.item_type.
--    Material: explode the DIRECT ppc_bom components of p_item_id x p_qty,
--              qty_required = qty_per * (1 + scrap_pct/100) * p_qty.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_create_work_order(
  p_item_id uuid,
  p_qty     numeric,
  p_line_id uuid    DEFAULT NULL,
  p_due     date    DEFAULT NULL,
  p_stages  text[]  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_wo_id      uuid;
  v_wo_number  text;
  v_item_type  text;
  v_email      text;
  v_qty        numeric := COALESCE(p_qty, 1);
  v_stages     text[];
  v_seq_no     int;
  v_stage      text;
  v_idx        int := 0;
  v_stage_cnt  int := 0;
  v_mat_cnt    int := 0;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'ppc_create_work_order: p_item_id is required';
  END IF;

  SELECT item_type INTO v_item_type FROM public.ppc_items WHERE id = p_item_id;
  IF v_item_type IS NULL THEN
    RAISE EXCEPTION 'ppc_create_work_order: item % not found', p_item_id;
  END IF;

  v_email := public.rbac_current_email();

  -- daily sequence: count of WOs created today + 1
  SELECT COUNT(*) + 1 INTO v_seq_no
  FROM public.ppc_wo
  WHERE created_at >= date_trunc('day', now())
    AND created_at <  date_trunc('day', now()) + interval '1 day';

  v_wo_number := 'WO-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_seq_no::text, 3, '0');

  INSERT INTO public.ppc_wo (wo_number, item_id, qty, line_id, status, due_date, owner_email)
  VALUES (v_wo_number, p_item_id, v_qty, p_line_id, 'planned', p_due, v_email)
  RETURNING id INTO v_wo_id;

  -- resolve routing stages
  IF p_stages IS NOT NULL AND array_length(p_stages, 1) IS NOT NULL THEN
    v_stages := p_stages;
  ELSE
    v_stages := CASE v_item_type
      WHEN 'cable'      THEN ARRAY['Drawing','Bunching','Insulation','Sheathing','Testing']
      WHEN 'power_cord' THEN ARRAY['Cutting','Stripping','Crimping','Moulding','Testing']
      WHEN 'harness'    THEN ARRAY['Cutting','Stripping','Crimping','Assembly','Continuity Test']
      ELSE                   ARRAY['Production','QC']
    END;
  END IF;

  FOREACH v_stage IN ARRAY v_stages
  LOOP
    INSERT INTO public.ppc_wo_stage (work_order_id, stage_name, sequence, status)
    VALUES (v_wo_id, v_stage, v_idx, 'pending');
    v_idx := v_idx + 1;
  END LOOP;
  v_stage_cnt := v_idx;

  -- pre-populate material kit from DIRECT BOM components
  INSERT INTO public.ppc_wo_material (work_order_id, item_id, qty_required, qty_issued)
  SELECT
    v_wo_id,
    b.component_item_id,
    (b.qty_per * (1 + COALESCE(b.scrap_pct, 0) / 100.0) * v_qty)::numeric,
    0
  FROM public.ppc_bom b
  WHERE b.parent_item_id = p_item_id;

  GET DIAGNOSTICS v_mat_cnt = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',          true,
    'id',          v_wo_id,
    'wo_number',   v_wo_number,
    'item_id',     p_item_id,
    'item_type',   v_item_type,
    'qty',         v_qty,
    'stage_count', v_stage_cnt,
    'material_count', v_mat_cnt
  );
END
$fn$;

-- ---------------------------------------------------------------------
-- 7) RPC - public.ppc_issue_material(...)
--      Issue p_qty against a kit line; stamp issuer; decrement on_hand.
--      Stock is only decremented if a ppc_stock row exists for the item
--      (we do not create negative phantom rows); otherwise a note is set.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_issue_material(
  p_wo_material_id uuid,
  p_qty            numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_item_id    uuid;
  v_issued     numeric;
  v_required   numeric;
  v_email      text;
  v_stock_seen boolean := false;
  v_on_hand    numeric;
  v_note       text := NULL;
BEGIN
  IF p_wo_material_id IS NULL THEN
    RAISE EXCEPTION 'ppc_issue_material: p_wo_material_id is required';
  END IF;
  IF COALESCE(p_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'ppc_issue_material: p_qty must be > 0';
  END IF;

  v_email := public.rbac_current_email();

  UPDATE public.ppc_wo_material
     SET qty_issued      = COALESCE(qty_issued, 0) + p_qty,
         issued_by_email = v_email,
         issued_at       = now()
   WHERE id = p_wo_material_id
   RETURNING item_id, qty_issued, qty_required INTO v_item_id, v_issued, v_required;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'ppc_issue_material: kit line % not found', p_wo_material_id;
  END IF;

  -- decrement stock only if a row exists
  IF EXISTS (SELECT 1 FROM public.ppc_stock WHERE item_id = v_item_id) THEN
    UPDATE public.ppc_stock
       SET on_hand    = COALESCE(on_hand, 0) - p_qty,
           updated_at = now()
     WHERE item_id = v_item_id
     RETURNING on_hand INTO v_on_hand;
    v_stock_seen := true;
  ELSE
    v_note := 'No ppc_stock row for item; stock not decremented.';
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'wo_material_id', p_wo_material_id,
    'item_id',        v_item_id,
    'issued_now',     p_qty,
    'qty_issued',     v_issued,
    'qty_required',   v_required,
    'stock_updated',  v_stock_seen,
    'remaining_stock', v_on_hand,
    'note',           v_note
  );
END
$fn$;

-- ---------------------------------------------------------------------
-- 8) RPC - public.ppc_advance_stage(...)
--      Move a stage's status (stamping started_at/completed_at), optionally
--      set output/scrap, then roll the parent WO status up:
--        - any stage 'running'  -> WO 'in_progress'
--        - all stages 'done'    -> WO 'qc' + produced_qty from last stage
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_advance_stage(
  p_stage_id uuid,
  p_status   text,
  p_output   numeric DEFAULT NULL,
  p_scrap    numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_wo_id        uuid;
  v_total        int;
  v_done         int;
  v_running      int;
  v_last_output  numeric;
  v_wo_status    text;
  v_produced     numeric;
BEGIN
  IF p_stage_id IS NULL THEN
    RAISE EXCEPTION 'ppc_advance_stage: p_stage_id is required';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending','running','done','blocked') THEN
    RAISE EXCEPTION 'ppc_advance_stage: invalid status %', p_status;
  END IF;

  UPDATE public.ppc_wo_stage
     SET status       = p_status,
         output_qty   = COALESCE(p_output, output_qty),
         scrap_qty    = COALESCE(p_scrap,  scrap_qty),
         started_at   = CASE WHEN p_status = 'running' AND started_at IS NULL
                             THEN now() ELSE started_at END,
         completed_at = CASE WHEN p_status = 'done'
                             THEN now() ELSE completed_at END
   WHERE id = p_stage_id
   RETURNING work_order_id INTO v_wo_id;

  IF v_wo_id IS NULL THEN
    RAISE EXCEPTION 'ppc_advance_stage: stage % not found', p_stage_id;
  END IF;

  -- aggregate stage states for the WO
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'done'),
    COUNT(*) FILTER (WHERE status = 'running')
  INTO v_total, v_done, v_running
  FROM public.ppc_wo_stage
  WHERE work_order_id = v_wo_id;

  -- output of the highest-sequence (last) stage
  SELECT output_qty INTO v_last_output
  FROM public.ppc_wo_stage
  WHERE work_order_id = v_wo_id
  ORDER BY sequence DESC, created_at DESC
  LIMIT 1;

  IF v_total > 0 AND v_done = v_total THEN
    -- all stages complete -> ready for final QC
    v_produced := COALESCE(v_last_output, p_output, 0);
    UPDATE public.ppc_wo
       SET status       = 'qc',
           produced_qty = v_produced,
           updated_at   = now()
     WHERE id = v_wo_id
       AND status NOT IN ('done','cancelled')
     RETURNING status INTO v_wo_status;
  ELSIF v_running > 0 OR p_status = 'running' THEN
    UPDATE public.ppc_wo
       SET status     = 'in_progress',
           updated_at = now()
     WHERE id = v_wo_id
       AND status IN ('planned','released')
     RETURNING status INTO v_wo_status;
  END IF;

  -- fall back to current WO status if no transition fired
  IF v_wo_status IS NULL THEN
    SELECT status INTO v_wo_status FROM public.ppc_wo WHERE id = v_wo_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'stage_id',      p_stage_id,
    'work_order_id', v_wo_id,
    'stage_status',  p_status,
    'wo_status',     v_wo_status,
    'stages_total',  v_total,
    'stages_done',   v_done,
    'produced_qty',  v_produced,
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',         s.id,
               'stage_name', s.stage_name,
               'sequence',   s.sequence,
               'status',     s.status,
               'output_qty', s.output_qty,
               'scrap_qty',  s.scrap_qty
             ) ORDER BY s.sequence)
      FROM public.ppc_wo_stage s
      WHERE s.work_order_id = v_wo_id
    ), '[]'::jsonb)
  );
END
$fn$;

-- ---------------------------------------------------------------------
-- 9) RPC - public.ppc_record_qc(...)
--      Log a QC check; if it is a passing check and every stage is done,
--      close the WO (status 'done').
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_record_qc(
  p_wo_id      uuid,
  p_stage_id   uuid,
  p_check_type text,
  p_result     text,
  p_value      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id        uuid;
  v_email     text;
  v_total     int;
  v_done      int;
  v_wo_status text;
  v_closed    boolean := false;
BEGIN
  IF p_wo_id IS NULL THEN
    RAISE EXCEPTION 'ppc_record_qc: p_wo_id is required';
  END IF;
  IF p_check_type IS NULL THEN
    RAISE EXCEPTION 'ppc_record_qc: p_check_type is required';
  END IF;
  IF p_result IS NULL OR p_result NOT IN ('pending','pass','fail') THEN
    RAISE EXCEPTION 'ppc_record_qc: invalid result %', p_result;
  END IF;

  v_email := public.rbac_current_email();

  INSERT INTO public.ppc_wo_qc (
    work_order_id, stage_id, check_type, result, measured_value,
    checked_by_email, checked_at
  )
  VALUES (
    p_wo_id, p_stage_id, p_check_type, p_result, p_value,
    v_email, now()
  )
  RETURNING id INTO v_id;

  -- if this is a passing check and all stages are done, close the WO
  IF p_result = 'pass' THEN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'done')
    INTO v_total, v_done
    FROM public.ppc_wo_stage
    WHERE work_order_id = p_wo_id;

    IF v_total > 0 AND v_done = v_total THEN
      UPDATE public.ppc_wo
         SET status     = 'done',
             updated_at = now()
       WHERE id = p_wo_id
         AND status NOT IN ('done','cancelled');
      v_closed := true;
    END IF;
  END IF;

  SELECT status INTO v_wo_status FROM public.ppc_wo WHERE id = p_wo_id;

  RETURN jsonb_build_object(
    'ok',            true,
    'id',            v_id,
    'work_order_id', p_wo_id,
    'stage_id',      p_stage_id,
    'check_type',    p_check_type,
    'result',        p_result,
    'measured_value',p_value,
    'wo_closed',     v_closed,
    'wo_status',     v_wo_status
  );
END
$fn$;

-- ---------------------------------------------------------------------
-- 10) RPC - public.ppc_shopfloor(...)
--       Board snapshot: active WOs (not done/cancelled) with item name,
--       line, status, due, and their stages (name/status/machine/operator),
--       optionally filtered by line. Returns a jsonb ARRAY.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_shopfloor(p_line_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',           w.id,
        'wo_number',    w.wo_number,
        'item_id',      w.item_id,
        'item_name',    it.name,
        'item_code',    it.code,
        'line_id',      w.line_id,
        'line_name',    ln.name,
        'status',       w.status,
        'priority',     w.priority,
        'qty',          w.qty,
        'produced_qty', w.produced_qty,
        'due_date',     w.due_date,
        'stages', COALESCE((
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'id',            s.id,
                     'stage_name',    s.stage_name,
                     'sequence',      s.sequence,
                     'status',        s.status,
                     'machine_id',    s.machine_id,
                     'machine_name',  m.name,
                     'operator_name', s.operator_name,
                     'output_qty',    s.output_qty,
                     'scrap_qty',     s.scrap_qty
                   ) ORDER BY s.sequence
                 )
          FROM public.ppc_wo_stage s
          LEFT JOIN public.ppc_machines m ON m.id = s.machine_id
          WHERE s.work_order_id = w.id
        ), '[]'::jsonb)
      )
      ORDER BY
        CASE w.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        w.due_date NULLS LAST,
        w.created_at
    ),
    '[]'::jsonb
  )
  FROM public.ppc_wo w
  LEFT JOIN public.ppc_items it ON it.id = w.item_id
  LEFT JOIN public.ppc_lines ln ON ln.id = w.line_id
  WHERE w.status NOT IN ('done','cancelled')
    AND (p_line_id IS NULL OR w.line_id = p_line_id);
$fn$;

-- ---------------------------------------------------------------------
-- 11) Grants on RPCs
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.ppc_create_work_order(uuid, numeric, uuid, date, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_issue_material(uuid, numeric)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_advance_stage(uuid, text, numeric, numeric)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_record_qc(uuid, uuid, text, text, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_shopfloor(uuid)                                         TO authenticated;

COMMIT;

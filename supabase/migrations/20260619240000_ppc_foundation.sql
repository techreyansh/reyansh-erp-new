-- =====================================================================
-- 20260619240000_ppc_foundation.sql
-- PPC (Production Planning & Control) FOUNDATION
--
-- Purpose
--   Lays the master-data + planning foundation for the PPC module:
--     * ppc_items     - unified item master (FG / sub-assembly / raw material)
--     * ppc_bom       - multi-level bill of materials (parent -> component)
--     * ppc_stock     - per-item stock + reorder logic
--     * ppc_lines     - production lines
--     * ppc_machines  - machines on a line
--   plus an MRP recursive-explosion engine:
--     * ppc_mrp(item, qty)  - explode BOM, net against stock, cost it
--     * ppc_low_stock()     - items at/below reorder point (store alerts)
--
-- Naming
--   Deliberately uses NEW table names that do NOT collide with the existing
--   PPC tables: ppc_bom_items, ppc_material_consumption, ppc_production_plans,
--   ppc_qc_reports, ppc_work_orders. (This is the master-data layer; those are
--   the transactional layer and remain untouched.)
--
-- Security model
--   PPC is an internal module, gated in the app by RBAC role. At the DB level
--   we keep it simple: RLS enabled, but a permissive policy for `authenticated`
--   (USING true / WITH CHECK true). Helpers public.is_super_admin() and
--   public.rbac_current_email() exist and may be used by callers, but are not
--   required for these permissive policies.
--
-- Idempotency
--   Fully re-runnable: IF NOT EXISTS / CREATE OR REPLACE / guarded DO blocks /
--   DROP POLICY IF EXISTS before CREATE POLICY. Wrapped in one BEGIN/COMMIT.
--
-- NOTE: This migration is authored only. It is NOT executed here.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) ppc_items - unified item master
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  item_type   text NOT NULL
                CHECK (item_type IN ('cable','power_cord','harness','component','raw_material')),
  uom         text DEFAULT 'pcs',
  unit_cost   numeric DEFAULT 0,
  is_active   boolean DEFAULT true,
  notes       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_items_item_type
  ON public.ppc_items (item_type);

-- ---------------------------------------------------------------------
-- 2) ppc_bom - multi-level BOM lines (parent item -> component item)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_bom (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_item_id    uuid NOT NULL REFERENCES public.ppc_items(id) ON DELETE CASCADE,
  component_item_id uuid NOT NULL REFERENCES public.ppc_items(id),
  qty_per           numeric NOT NULL DEFAULT 1,
  scrap_pct         numeric NOT NULL DEFAULT 0,
  sequence          int DEFAULT 0,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (parent_item_id, component_item_id)
);

CREATE INDEX IF NOT EXISTS idx_ppc_bom_parent_item_id
  ON public.ppc_bom (parent_item_id);

-- ---------------------------------------------------------------------
-- 3) ppc_stock - per-item stock + reorder logic
--    reorder_point is stored (user-set or app-computed as
--    safety_stock + lead-time demand); MRP/low-stock read it directly.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_stock (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        uuid UNIQUE REFERENCES public.ppc_items(id) ON DELETE CASCADE,
  on_hand        numeric NOT NULL DEFAULT 0,
  reorder_point  numeric DEFAULT 0,
  safety_stock   numeric DEFAULT 0,
  lead_time_days int DEFAULT 7,
  location       text,
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_stock_item_id
  ON public.ppc_stock (item_id);

-- ---------------------------------------------------------------------
-- 4) ppc_lines - production lines
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  line_type   text,
  sequence    int DEFAULT 0,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5) ppc_machines - machines on a line
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppc_machines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id       uuid REFERENCES public.ppc_lines(id) ON DELETE SET NULL,
  name          text NOT NULL,
  machine_type  text,
  status        text DEFAULT 'idle'
                  CHECK (status IN ('idle','running','maintenance','down')),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_machines_line_id
  ON public.ppc_machines (line_id);

-- ---------------------------------------------------------------------
-- 6) Row Level Security + grants
--    Internal module: permissive policy for `authenticated`.
--    Guarded DO block so policy creation is idempotent.
-- ---------------------------------------------------------------------
ALTER TABLE public.ppc_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppc_bom      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppc_stock    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppc_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppc_machines ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_items    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_bom      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_stock    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_lines    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppc_machines TO authenticated;

DO $rls$
DECLARE
  t text;
  pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ppc_items','ppc_bom','ppc_stock','ppc_lines','ppc_machines'
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
-- 7) MRP ENGINE - public.ppc_mrp(p_item_id, p_qty)
--
--    Approach
--      Recursive CTE explodes ppc_bom from p_item_id for p_qty:
--        - base       : direct components of p_item_id, required = p_qty * qty_per
--                       * (1 + scrap_pct/100.0)
--        - recursive  : for each exploded row, pull ITS components and scale by
--                       the running `required` qty (parent_required * qty_per
--                       * (1 + scrap_pct/100.0))
--      Cycle guard: carry a `path` uuid[] of visited parent items and a `depth`
--      counter. We only recurse into a component when it is NOT already in the
--      path AND depth < 10. This protects against BOM cycles AND caps runaway
--      depth on accidental near-cycles / very deep trees.
--
--      All quantity math is numeric (qty_per/scrap_pct are numeric columns;
--      p_qty is numeric) so column types stay consistent across the UNION.
--
--    Aggregation
--      Sum `required` per component_item_id across the whole explosion, then
--      LEFT JOIN ppc_items (code/name/type/uom/unit_cost) and ppc_stock
--      (on_hand/reorder_point/lead_time_days). Per item:
--        shortage      = greatest(0, required - coalesce(on_hand,0))
--        below_reorder = (coalesce(on_hand,0) - required) < coalesce(reorder_point,0)
--        est_cost      = required * coalesce(unit_cost,0)
--      Lines ordered by item_type, then shortage desc.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_mrp(p_item_id uuid, p_qty numeric)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH RECURSIVE explosion AS (
    -- base: direct components of the requested item
    SELECT
      b.component_item_id                                              AS item_id,
      (p_qty * b.qty_per * (1 + b.scrap_pct / 100.0))::numeric         AS required,
      1                                                                AS depth,
      ARRAY[p_item_id, b.component_item_id]                            AS path
    FROM public.ppc_bom b
    WHERE b.parent_item_id = p_item_id

    UNION ALL

    -- recursive: explode each component's own BOM, scaling by running required
    SELECT
      b.component_item_id                                              AS item_id,
      (e.required * b.qty_per * (1 + b.scrap_pct / 100.0))::numeric    AS required,
      e.depth + 1                                                      AS depth,
      e.path || b.component_item_id                                    AS path
    FROM explosion e
    JOIN public.ppc_bom b
      ON b.parent_item_id = e.item_id
    WHERE e.depth < 10
      AND NOT (b.component_item_id = ANY (e.path))   -- cycle guard
  ),
  agg AS (
    SELECT
      item_id,
      SUM(required)::numeric AS required
    FROM explosion
    GROUP BY item_id
  ),
  lines AS (
    SELECT
      a.item_id,
      it.code,
      it.name,
      it.item_type,
      COALESCE(it.uom, 'pcs')                                         AS uom,
      a.required,
      COALESCE(s.on_hand, 0)::numeric                                 AS on_hand,
      COALESCE(s.reorder_point, 0)::numeric                           AS reorder_point,
      COALESCE(s.lead_time_days, 0)                                   AS lead_time_days,
      GREATEST(0, a.required - COALESCE(s.on_hand, 0))::numeric       AS shortage,
      ((COALESCE(s.on_hand, 0) - a.required) < COALESCE(s.reorder_point, 0)) AS below_reorder,
      (a.required * COALESCE(it.unit_cost, 0))::numeric               AS est_cost
    FROM agg a
    LEFT JOIN public.ppc_items it ON it.id = a.item_id
    LEFT JOIN public.ppc_stock s  ON s.item_id = a.item_id
  )
  SELECT jsonb_build_object(
    'item_id', p_item_id,
    'qty',     p_qty,
    'lines',   COALESCE(
                 (SELECT jsonb_agg(
                    jsonb_build_object(
                      'item_id',         l.item_id,
                      'code',            l.code,
                      'name',            l.name,
                      'item_type',       l.item_type,
                      'uom',             l.uom,
                      'required',        l.required,
                      'on_hand',         l.on_hand,
                      'reorder_point',   l.reorder_point,
                      'lead_time_days',  l.lead_time_days,
                      'shortage',        l.shortage,
                      'below_reorder',   l.below_reorder,
                      'suggest_purchase',(l.shortage > 0),
                      'est_cost',        l.est_cost
                    )
                    ORDER BY l.item_type, l.shortage DESC
                  )
                  FROM lines l),
                 '[]'::jsonb
               ),
    'total_est_cost', COALESCE((SELECT SUM(l.est_cost) FROM lines l), 0),
    'shortage_count', COALESCE((SELECT COUNT(*) FROM lines l WHERE l.shortage > 0), 0)
  );
$fn$;

-- ---------------------------------------------------------------------
-- 8) public.ppc_low_stock() - items at/below reorder point
--    Returns a jsonb ARRAY of {item_id, code, name, on_hand, reorder_point,
--    shortage:=greatest(0, reorder_point - on_hand)} for store reorder alerts
--    and the plant dashboard.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_low_stock()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'item_id',       it.id,
        'code',          it.code,
        'name',          it.name,
        'on_hand',       COALESCE(s.on_hand, 0),
        'reorder_point', COALESCE(s.reorder_point, 0),
        'shortage',      GREATEST(0, COALESCE(s.reorder_point, 0) - COALESCE(s.on_hand, 0))
      )
      ORDER BY GREATEST(0, COALESCE(s.reorder_point, 0) - COALESCE(s.on_hand, 0)) DESC, it.code
    ),
    '[]'::jsonb
  )
  FROM public.ppc_stock s
  JOIN public.ppc_items it ON it.id = s.item_id
  WHERE COALESCE(s.on_hand, 0) <= COALESCE(s.reorder_point, 0)
    AND it.is_active IS NOT FALSE;
$fn$;

GRANT EXECUTE ON FUNCTION public.ppc_mrp(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_low_stock()        TO authenticated;

COMMIT;

-- =====================================================================
-- MES Routing-Driven Redesign — P0 (schema + version-safety, additive)
-- =====================================================================
-- Plan: MES_ROUTING_REDESIGN_PLAN.md (reduced scope). Moves cycle time off the
-- generic Process Master onto per-product routing, with mold binding + routing
-- versioning. Bakes in the /autoplan eng gates:
--   C1 — routing edits go through an atomic, version-scoped RPC (no delete-all).
--   C2 — exactly one active routing_version per product (partial unique index +
--        atomic supersede-then-activate inside one RPC).
--   H1/H2 — category-aware backfill: molding steps inherit cycle from the mold
--        (never copy per-piece time into per-cycle time); mold binding only when
--        unambiguous; coverage reported via RAISE NOTICE.
-- Fully additive. Cable production is untouched (payload-driven path).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Level 1 — Process Master (assembly_operation): generic metadata only.
--    std_time_sec is DEMOTED to a fallback; the engines stop trusting it as truth.
-- ---------------------------------------------------------------------
ALTER TABLE public.assembly_operation
  ADD COLUMN IF NOT EXISTS machine_type           text,
  ADD COLUMN IF NOT EXISTS constraint_type         text DEFAULT 'labour'
    CHECK (constraint_type IN ('machine','labour')),
  ADD COLUMN IF NOT EXISTS parallel_allowed        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_oee             numeric DEFAULT 0.85,
  ADD COLUMN IF NOT EXISTS default_setup_sec       numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_changeover_sec  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skills_required         text;

-- molding ops are machine-constrained; default that for the seeded molding category
UPDATE public.assembly_operation SET constraint_type = 'machine'
 WHERE category = 'molding' AND constraint_type = 'labour';

-- ---------------------------------------------------------------------
-- 3. Routing versioning (do this before stamping steps in §2's backfill).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.engineering_change_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecn_number text UNIQUE,
  reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','implemented','cancelled')),
  affected_product_ids jsonb DEFAULT '[]'::jsonb,
  raised_by_email text,
  approved_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routing_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.product(id) ON DELETE CASCADE,
  version_number int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded')),
  effective_from timestamptz,
  effective_to timestamptz,
  ecn_id uuid REFERENCES public.engineering_change_note(id) ON DELETE SET NULL,
  approved_by_email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, version_number)
);

-- C2: at most one active version per product, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_version_active
  ON public.routing_version (product_id) WHERE status = 'active';

-- ---------------------------------------------------------------------
-- 2. Level 2 — Part Operation Master / Routing (product_process_step):
--    the source of truth. All production params live here, per part.
-- ---------------------------------------------------------------------
ALTER TABLE public.product_process_step
  ADD COLUMN IF NOT EXISTS routing_version_id    uuid REFERENCES public.routing_version(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mold_id               uuid REFERENCES public.molding_master(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cycle_time_sec        numeric,
  ADD COLUMN IF NOT EXISTS cavities              int,
  ADD COLUMN IF NOT EXISTS output_per_cycle      numeric,
  ADD COLUMN IF NOT EXISTS scrap_pct             numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_time_sec        numeric,
  ADD COLUMN IF NOT EXISTS changeover_time_sec   numeric,
  ADD COLUMN IF NOT EXISTS parallel_machines     int,
  ADD COLUMN IF NOT EXISTS min_operators         int,
  ADD COLUMN IF NOT EXISTS max_operators         int,
  ADD COLUMN IF NOT EXISTS oee                   numeric,
  ADD COLUMN IF NOT EXISTS quality_check_required boolean;

CREATE INDEX IF NOT EXISTS idx_pps_routing_version ON public.product_process_step (routing_version_id);

-- ---------------------------------------------------------------------
-- 4. Mold Master (molding_master): preventive-maintenance + part fields.
-- ---------------------------------------------------------------------
ALTER TABLE public.molding_master
  ADD COLUMN IF NOT EXISTS part_number        text,
  ADD COLUMN IF NOT EXISTS pm_interval_shots  numeric,
  ADD COLUMN IF NOT EXISTS last_pm_date       date,
  ADD COLUMN IF NOT EXISTS next_pm_due_shots  numeric;

-- ---------------------------------------------------------------------
-- 5a. RPC — atomic, version-scoped routing save (fixes C1).
--     Supersedes the current active version, mints a new active version, and
--     inserts the steps stamped to it, all in one transaction. Old versions'
--     rows are preserved (history), never deleted.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mes_save_routing(p_product_id uuid, p_steps jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := auth.jwt() ->> 'email';
  v_num int;
  v_ver uuid;
  v_count int := 0;
BEGIN
  IF p_product_id IS NULL THEN RAISE EXCEPTION 'product_id required'; END IF;

  -- supersede the existing active version (frees the partial-unique slot)
  UPDATE public.routing_version
     SET status = 'superseded', effective_to = now()
   WHERE product_id = p_product_id AND status = 'active';

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_num
    FROM public.routing_version WHERE product_id = p_product_id;

  INSERT INTO public.routing_version (product_id, version_number, status, effective_from, approved_by_email)
  VALUES (p_product_id, v_num, 'active', now(), v_email)
  RETURNING id INTO v_ver;

  INSERT INTO public.product_process_step (
    product_id, routing_version_id, sequence, step_name, department, machine, operation_id,
    standard_time_sec, cycle_time_sec, manpower, mold_id, cavities, output_per_cycle, scrap_pct,
    setup_time_sec, changeover_time_sec, parallel_machines, min_operators, max_operators, oee,
    quality_check_required, notes
  )
  SELECT
    p_product_id, v_ver,
    COALESCE((s->>'sequence')::int, (ord - 1)::int),
    NULLIF(s->>'step_name',''), NULLIF(s->>'department',''), NULLIF(s->>'machine',''),
    NULLIF(s->>'operation_id','')::uuid,
    NULLIF(s->>'standard_time_sec','')::numeric, NULLIF(s->>'cycle_time_sec','')::numeric,
    NULLIF(s->>'manpower','')::int, NULLIF(s->>'mold_id','')::uuid,
    NULLIF(s->>'cavities','')::int, NULLIF(s->>'output_per_cycle','')::numeric,
    COALESCE(NULLIF(s->>'scrap_pct','')::numeric, 0),
    NULLIF(s->>'setup_time_sec','')::numeric, NULLIF(s->>'changeover_time_sec','')::numeric,
    NULLIF(s->>'parallel_machines','')::int, NULLIF(s->>'min_operators','')::int,
    NULLIF(s->>'max_operators','')::int, NULLIF(s->>'oee','')::numeric,
    COALESCE((s->>'quality_check_required')::boolean, false),
    NULLIF(s->>'notes','')
  FROM jsonb_array_elements(COALESCE(p_steps, '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'routing_version_id', v_ver, 'version_number', v_num, 'steps', v_count);
END $$;
GRANT EXECUTE ON FUNCTION public.mes_save_routing(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 5b. RPC — atomic activate of an existing draft version (fixes C2 flip race).
--     Supersedes the current active, activates the target, in one transaction.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mes_activate_routing_version(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product uuid;
BEGIN
  SELECT product_id INTO v_product FROM public.routing_version WHERE id = p_version_id;
  IF v_product IS NULL THEN RAISE EXCEPTION 'routing version not found'; END IF;

  UPDATE public.routing_version SET status = 'superseded', effective_to = now()
   WHERE product_id = v_product AND status = 'active' AND id <> p_version_id;

  UPDATE public.routing_version SET status = 'active', effective_from = now(), effective_to = NULL
   WHERE id = p_version_id;

  RETURN jsonb_build_object('ok', true, 'routing_version_id', p_version_id);
END $$;
GRANT EXECUTE ON FUNCTION public.mes_activate_routing_version(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Backfill — give every product with steps a v1 'active' routing_version,
--    stamp its existing steps onto it, and set per-op params category-aware.
--    H2: do NOT copy standard_time_sec into cycle_time_sec for molding steps —
--        leave NULL so they inherit the mold's real per-cycle time.
--    H1: bind mold_id only when EXACTLY ONE active mold matches; else leave NULL.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r_prod uuid;
  v_ver uuid;
  v_bound int := 0;
  v_ambig int := 0;
  v_total_mold int := 0;
BEGIN
  FOR r_prod IN
    SELECT DISTINCT product_id FROM public.product_process_step
     WHERE product_id IS NOT NULL AND routing_version_id IS NULL
  LOOP
    -- one active version per product (skip if one somehow already exists)
    IF EXISTS (SELECT 1 FROM public.routing_version WHERE product_id = r_prod AND status = 'active') THEN
      SELECT id INTO v_ver FROM public.routing_version WHERE product_id = r_prod AND status = 'active' LIMIT 1;
    ELSE
      INSERT INTO public.routing_version (product_id, version_number, status, effective_from, notes)
      VALUES (r_prod, 1, 'active', now(), 'backfill v1 from existing routing')
      RETURNING id INTO v_ver;
    END IF;

    -- stamp existing (unversioned) steps onto v1
    UPDATE public.product_process_step
       SET routing_version_id = v_ver
     WHERE product_id = r_prod AND routing_version_id IS NULL;
  END LOOP;

  -- labour steps: cycle = the per-piece standard time (1 pc per cycle)
  UPDATE public.product_process_step pps
     SET cycle_time_sec = pps.standard_time_sec
    FROM public.assembly_operation ao
   WHERE pps.operation_id = ao.id
     AND COALESCE(ao.category,'') <> 'molding'
     AND pps.cycle_time_sec IS NULL
     AND pps.standard_time_sec IS NOT NULL;

  -- molding steps: bind a mold only when unambiguous; leave cycle NULL (inherit).
  -- mold_type derived from operation_code (inner_/outer_/grommet_*). Scalar
  -- subquery in SET (not a LATERAL) so it can reference the UPDATE target pps.
  UPDATE public.product_process_step pps
     SET mold_id = (
       SELECT mm.id FROM public.molding_master mm
        WHERE mm.product_id = pps.product_id
          AND mm.status = 'active'
          AND mm.mold_type = CASE
              WHEN ao.operation_code ILIKE 'inner%'   THEN 'inner'
              WHEN ao.operation_code ILIKE 'outer%'   THEN 'outer'
              WHEN ao.operation_code ILIKE 'grommet%' THEN 'grommet'
              ELSE NULL END
        LIMIT 1)
    FROM public.assembly_operation ao
   WHERE pps.operation_id = ao.id
     AND ao.category = 'molding'
     AND pps.mold_id IS NULL
     -- only bind when exactly one active mold matches (ambiguity-safe)
     AND (SELECT count(*) FROM public.molding_master mm2
           WHERE mm2.product_id = pps.product_id AND mm2.status = 'active'
             AND mm2.mold_type = CASE
                 WHEN ao.operation_code ILIKE 'inner%'   THEN 'inner'
                 WHEN ao.operation_code ILIKE 'outer%'   THEN 'outer'
                 WHEN ao.operation_code ILIKE 'grommet%' THEN 'grommet'
                 ELSE NULL END) = 1;

  -- coverage report (visible in migration output)
  SELECT count(*) INTO v_total_mold FROM public.product_process_step pps
    JOIN public.assembly_operation ao ON ao.id = pps.operation_id WHERE ao.category = 'molding';
  SELECT count(*) INTO v_bound FROM public.product_process_step pps
    JOIN public.assembly_operation ao ON ao.id = pps.operation_id
   WHERE ao.category = 'molding' AND pps.mold_id IS NOT NULL;
  SELECT count(*) INTO v_ambig FROM public.product_process_step pps
    JOIN public.assembly_operation ao ON ao.id = pps.operation_id
   WHERE ao.category = 'molding' AND pps.mold_id IS NULL;
  RAISE NOTICE 'mes_routing_p0 backfill: molding steps total=%, mold-bound=%, left-to-fallback=% (ambiguous/none)',
    v_total_mold, v_bound, v_ambig;
END $$;

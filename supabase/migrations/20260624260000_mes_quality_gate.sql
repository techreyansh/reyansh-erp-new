-- =====================================================================
-- MES Phase 3 — server-enforced quality gate (additive trigger)
-- =====================================================================
-- A stage cannot be set to 'done' if its operation is quality_critical and
-- there is no passing ppc_wo_qc for it. Implemented as a BEFORE UPDATE trigger
-- so it enforces on EVERY path (RPC, direct write) without rewriting the live
-- ppc_advance_stage RPC (which cable production depends on). Scoped by an
-- operation-name match to a quality_critical assembly_operation, so cable
-- stages (Drawing/Bunching/.../Testing) — which have no such match — are never
-- affected. Additive.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.mes_stage_quality_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'done' AND COALESCE(OLD.status, '') <> 'done' THEN
    IF EXISTS (
      SELECT 1 FROM public.assembly_operation ao
      WHERE lower(ao.name) = lower(NEW.stage_name) AND ao.quality_critical AND ao.is_active
    ) AND NOT EXISTS (
      SELECT 1 FROM public.ppc_wo_qc q WHERE q.stage_id = NEW.id AND q.result = 'pass'
    ) THEN
      RAISE EXCEPTION 'Stage "%" is quality-critical — record a passing QC before completing it.', NEW.stage_name;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mes_stage_quality_gate ON public.ppc_wo_stage;
CREATE TRIGGER trg_mes_stage_quality_gate
  BEFORE UPDATE ON public.ppc_wo_stage
  FOR EACH ROW EXECUTE FUNCTION public.mes_stage_quality_gate();

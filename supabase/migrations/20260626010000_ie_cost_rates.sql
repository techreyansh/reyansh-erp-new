-- IE planning C1a: the cost-rate master the optimizer consumes (ieScenario/costModel),
-- plus the RLS retrofit the eng review flagged on the routing tables that shipped open.

CREATE TABLE IF NOT EXISTS public.ie_cost_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department          text,              -- NULL = the default/fallback rate
  labour_per_hr       numeric NOT NULL DEFAULT 0,
  overtime_multiplier numeric NOT NULL DEFAULT 1.5,
  machine_per_hr      numeric NOT NULL DEFAULT 0,
  indirect_pct        numeric NOT NULL DEFAULT 0,   -- e.g. 0.15 = +15% indirect
  currency            text NOT NULL DEFAULT 'INR',
  effective_from      date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ie_cost_rates_dept
  ON public.ie_cost_rates (COALESCE(department, '__default__'));

ALTER TABLE public.ie_cost_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ie_cost_rates_all ON public.ie_cost_rates;
CREATE POLICY ie_cost_rates_all ON public.ie_cost_rates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ie_cost_rates TO authenticated;

-- A default rate row so the planner computes cost/pc out of the box (editable in UI).
INSERT INTO public.ie_cost_rates (department, labour_per_hr, overtime_multiplier, machine_per_hr, indirect_pct)
SELECT NULL, 80, 1.5, 50, 0.15
WHERE NOT EXISTS (SELECT 1 FROM public.ie_cost_rates WHERE department IS NULL);

-- RLS retrofit: routing_version + engineering_change_note shipped with RLS off.
-- Writes go through SECURITY DEFINER RPCs (bypass RLS); add permissive read/write
-- for authenticated to match the rest of the routing family.
DO $$
BEGIN
  IF to_regclass('public.routing_version') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.routing_version ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS routing_version_all ON public.routing_version';
    EXECUTE 'CREATE POLICY routing_version_all ON public.routing_version FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF to_regclass('public.engineering_change_note') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.engineering_change_note ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS engineering_change_note_all ON public.engineering_change_note';
    EXECUTE 'CREATE POLICY engineering_change_note_all ON public.engineering_change_note FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

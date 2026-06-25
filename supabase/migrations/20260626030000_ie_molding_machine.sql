-- IE planning P3: the shared molding-machine FLEET (the pool that feeds all
-- assembly lines). Additive + provisional shape — confirm with the owner before
-- any data depends on it. Capacity per machine = cavities × (3600/cycle) × hours.
-- The standard cell (2 inner + 1 outer + 1 grommet) is seeded as a starting point.

CREATE TABLE IF NOT EXISTS public.ie_molding_machine (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_code    text UNIQUE,
  name            text,
  mold_type       text NOT NULL DEFAULT 'inner' CHECK (mold_type IN ('inner','outer','grommet')),
  cycle_time_sec  numeric,
  cavities        int NOT NULL DEFAULT 1,
  available_hours numeric NOT NULL DEFAULT 8,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ie_molding_machine ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ie_molding_machine_all ON public.ie_molding_machine;
CREATE POLICY ie_molding_machine_all ON public.ie_molding_machine
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ie_molding_machine TO authenticated;

-- Seed the standard cell once (only if the fleet is empty).
INSERT INTO public.ie_molding_machine (machine_code, name, mold_type, cycle_time_sec, cavities, available_hours)
SELECT * FROM (VALUES
  ('IM-1', 'Inner Mold 1', 'inner',   45, 2, 8),
  ('IM-2', 'Inner Mold 2', 'inner',   45, 2, 8),
  ('OM-1', 'Outer Mold',   'outer',   60, 1, 8),
  ('GR-1', 'Grommet',      'grommet', 30, 4, 8)
) AS s(machine_code, name, mold_type, cycle_time_sec, cavities, available_hours)
WHERE NOT EXISTS (SELECT 1 FROM public.ie_molding_machine);

-- Planning Presets (UX overhaul Wave 4): named, user-managed sets of planning
-- options the Auto Planner can apply in one click. Just stored options — the
-- scheduling engine is unchanged. Seeded with the examples from the brief.
BEGIN;

CREATE TABLE IF NOT EXISTS public.planning_preset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, name text, description text,
  priority text DEFAULT 'due_date',     -- due_date | manual | created
  mode text DEFAULT 'forward',          -- forward | reverse
  batching boolean DEFAULT false,
  batch_window int DEFAULT 7,
  check_stock text DEFAULT 'warn',      -- ignore | warn | block
  scope text DEFAULT 'pending',         -- pending | all
  is_active boolean DEFAULT true, archived_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS planning_preset_code_uq ON public.planning_preset (lower(code)) WHERE code IS NOT NULL;

INSERT INTO public.planning_preset (code, name, description, priority, mode, batching, batch_window, check_stock, scope)
SELECT * FROM (VALUES
  ('STD',     'Standard Cable Production', 'Due-date order, forward schedule, warn on shortage', 'due_date', 'forward', false, 7, 'warn',  'pending'),
  ('SMALL',   'Small Batch Planning',      'Batch similar specs in a tight window',              'due_date', 'forward', true,  3, 'warn',  'pending'),
  ('HIPRI',   'High Priority Orders',      'Manual priority first, block if short',              'manual',   'reverse', false, 7, 'block', 'pending'),
  ('EXPORT',  'Export Orders',             'Reverse-from-due so export deadlines hold',          'due_date', 'reverse', true,  14,'block', 'all'),
  ('PWRCORD', 'Power Cord Production',     'Batch power cords, warn on shortage',                'due_date', 'forward', true,  7, 'warn',  'pending')
) v(code,name,description,priority,mode,batching,batch_window,check_stock,scope)
WHERE NOT EXISTS (SELECT 1 FROM public.planning_preset p WHERE lower(p.code)=lower(v.code));

ALTER TABLE public.planning_preset ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS planning_preset_all ON public.planning_preset;
CREATE POLICY planning_preset_all ON public.planning_preset FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_audit_planning_preset ON public.planning_preset;
CREATE TRIGGER trg_audit_planning_preset AFTER INSERT OR UPDATE OR DELETE ON public.planning_preset
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();

COMMIT;

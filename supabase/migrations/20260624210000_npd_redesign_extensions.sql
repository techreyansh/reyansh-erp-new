-- =====================================================================
-- NPD customer-centric redesign — extensions
-- =====================================================================
-- Sample intake detail (P3), sample dispatch tracking (P6), document
-- categories + version control (P4). Additive.
-- =====================================================================

-- P3 — richer sample intake
ALTER TABLE public.npd_sample
  ADD COLUMN IF NOT EXISTS received_date date,
  ADD COLUMN IF NOT EXISTS received_by   text,
  ADD COLUMN IF NOT EXISTS sample_type   text,   -- customer|our|competitor|reference
  ADD COLUMN IF NOT EXISTS condition     text,   -- good|damaged|partial
  ADD COLUMN IF NOT EXISTS remarks       text;

-- P4 — document category + version control
ALTER TABLE public.npd_document
  ADD COLUMN IF NOT EXISTS category   text,        -- customer_drawing|internal_drawing|bom|costing|inspection|test_report|quality|photo|video|email|approval|ppap|tech_note|work_instruction|certificate|other
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_status text;   -- pending|approved|rejected

-- P6 — sample dispatch tracking
CREATE TABLE IF NOT EXISTS public.npd_dispatch (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.npd_project(id) ON DELETE CASCADE,
  sample_id        uuid REFERENCES public.npd_sample(id) ON DELETE SET NULL,
  revision         int NOT NULL DEFAULT 0,
  dispatch_date    date,
  courier          text,
  tracking_no      text,
  quantity         numeric,
  receiver         text,
  feedback_due_date date,
  feedback_status  text NOT NULL DEFAULT 'pending' CHECK (feedback_status IN ('pending','received','overdue')),
  notes            text,
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_npd_dispatch_project ON public.npd_dispatch (project_id);

ALTER TABLE public.npd_dispatch ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY npd_dispatch_all ON public.npd_dispatch FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.npd_dispatch TO authenticated;

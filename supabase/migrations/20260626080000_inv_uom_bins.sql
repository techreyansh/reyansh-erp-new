-- Inventory Phase 2 (additive): UoM conversions + storage bins.
--  - inv_uom_conversion: per-item alternate units (1 alt = factor_to_base base units),
--    so users can receive/issue/read in rolls/bags/cartons while the ledger stays
--    in base UoM (ppc_items.uom). The ledger schema is untouched.
--  - inv_bin: named storage bins within a location; ppc_items.bin_id = an item's
--    home bin (putaway location). Per-bin QUANTITY tracking (re-keying the ledger)
--    is a later layer that builds on this master.

CREATE TABLE IF NOT EXISTS public.inv_uom_conversion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        uuid NOT NULL REFERENCES public.ppc_items(id) ON DELETE CASCADE,
  alt_uom        text NOT NULL,
  factor_to_base numeric NOT NULL CHECK (factor_to_base > 0),  -- 1 alt_uom = N base units
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, alt_uom)
);
ALTER TABLE public.inv_uom_conversion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_uom_conversion_all ON public.inv_uom_conversion;
CREATE POLICY inv_uom_conversion_all ON public.inv_uom_conversion FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inv_uom_conversion TO authenticated;

CREATE TABLE IF NOT EXISTS public.inv_bin (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.inv_location(id) ON DELETE CASCADE,
  bin_code    text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, bin_code)
);
ALTER TABLE public.inv_bin ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_bin_all ON public.inv_bin;
CREATE POLICY inv_bin_all ON public.inv_bin FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inv_bin TO authenticated;

-- An item's home/putaway bin.
ALTER TABLE public.ppc_items ADD COLUMN IF NOT EXISTS bin_id uuid REFERENCES public.inv_bin(id) ON DELETE SET NULL;

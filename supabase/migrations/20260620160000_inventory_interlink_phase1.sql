-- Inventory interlink, Phase 1. Makes the PPC store the inventory backbone:
--   * item <-> vendor linkage (preferred vendor, lead time, price) so a shortage
--     knows who to reorder from;
--   * a stock-movement audit ledger (auto-captured via trigger);
--   * planning fields on ppc_stock (max_qty, avg_daily_demand) for excess /
--     days-of-cover;
--   * reorder-board + excess RPCs that drive the new Inventory dashboards.
-- Additive only; existing ppc_* behaviour is unchanged.
BEGIN;

-- 1) Item -> Vendor linkage (vendor stored denormalised to avoid the sheet join).
CREATE TABLE IF NOT EXISTS public.ppc_item_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.ppc_items(id) ON DELETE CASCADE,
  vendor_code text,
  vendor_name text,
  is_preferred boolean DEFAULT false,
  lead_time_days integer DEFAULT 7,
  unit_cost numeric DEFAULT 0,
  moq numeric DEFAULT 0,
  last_quote_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ppc_item_vendors_item ON public.ppc_item_vendors(item_id);
-- at most one preferred vendor per item
CREATE UNIQUE INDEX IF NOT EXISTS idx_ppc_item_vendors_preferred
  ON public.ppc_item_vendors(item_id) WHERE is_preferred IS TRUE;
ALTER TABLE public.ppc_item_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ppc_item_vendors_all ON public.ppc_item_vendors;
CREATE POLICY ppc_item_vendors_all ON public.ppc_item_vendors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Stock-movement audit ledger.
CREATE TABLE IF NOT EXISTS public.ppc_stock_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES public.ppc_items(id) ON DELETE CASCADE,
  quantity_delta numeric NOT NULL,
  on_hand_after numeric,
  transaction_type text NOT NULL DEFAULT 'adjust',  -- receipt|issue|dispatch|adjust
  reference_type text,
  reference_id text,
  notes text,
  created_by_email text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ppc_stock_txn_item ON public.ppc_stock_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_ppc_stock_txn_created ON public.ppc_stock_transactions(created_at DESC);
ALTER TABLE public.ppc_stock_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ppc_stock_txn_all ON public.ppc_stock_transactions;
CREATE POLICY ppc_stock_txn_all ON public.ppc_stock_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Auto-log any on_hand change on ppc_stock (captures all sources for now).
CREATE OR REPLACE FUNCTION public.ppc_stock_audit_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.on_hand IS DISTINCT FROM OLD.on_hand THEN
    INSERT INTO public.ppc_stock_transactions(item_id, quantity_delta, on_hand_after, transaction_type, notes)
    VALUES (NEW.item_id, NEW.on_hand - OLD.on_hand, NEW.on_hand,
            CASE WHEN NEW.on_hand > OLD.on_hand THEN 'receipt' ELSE 'issue' END, 'auto');
  ELSIF TG_OP = 'INSERT' AND COALESCE(NEW.on_hand,0) <> 0 THEN
    INSERT INTO public.ppc_stock_transactions(item_id, quantity_delta, on_hand_after, transaction_type, notes)
    VALUES (NEW.item_id, NEW.on_hand, NEW.on_hand, 'receipt', 'opening');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ppc_stock_audit ON public.ppc_stock;
CREATE TRIGGER trg_ppc_stock_audit
  AFTER INSERT OR UPDATE ON public.ppc_stock
  FOR EACH ROW EXECUTE FUNCTION public.ppc_stock_audit_trg();

-- 3) Planning fields for excess / days-of-cover.
ALTER TABLE public.ppc_stock ADD COLUMN IF NOT EXISTS max_qty numeric;
ALTER TABLE public.ppc_stock ADD COLUMN IF NOT EXISTS avg_daily_demand numeric;

-- 4) Reorder board: shortage items + suggested qty + preferred vendor + cover.
CREATE OR REPLACE FUNCTION public.ppc_reorder_board()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.shortage DESC), '[]'::jsonb)
  FROM (
    SELECT
      i.id AS item_id, i.code, i.name, i.item_type, i.uom,
      s.on_hand, s.reorder_point, s.safety_stock, s.lead_time_days, s.location,
      GREATEST(COALESCE(s.reorder_point,0) - COALESCE(s.on_hand,0), 0) AS shortage,
      CEIL(GREATEST(
        COALESCE(s.max_qty, COALESCE(s.reorder_point,0) * 2) - COALESCE(s.on_hand,0),
        COALESCE(pv.moq, 0)
      ))::numeric AS suggested_qty,
      CASE WHEN COALESCE(s.avg_daily_demand,0) > 0
           THEN ROUND(s.on_hand / s.avg_daily_demand, 1) END AS days_of_cover,
      pv.vendor_code, pv.vendor_name,
      COALESCE(pv.lead_time_days, s.lead_time_days) AS vendor_lead_time,
      pv.unit_cost AS vendor_unit_cost
    FROM public.ppc_stock s
    JOIN public.ppc_items i ON i.id = s.item_id AND i.is_active
    LEFT JOIN public.ppc_item_vendors pv ON pv.item_id = s.item_id AND pv.is_preferred
    WHERE COALESCE(s.on_hand,0) <= COALESCE(s.reorder_point,0)
  ) t;
$$;

-- 5) Excess / slow-moving stock: above max, or very high days-of-cover.
CREATE OR REPLACE FUNCTION public.ppc_excess_stock(p_cover_threshold numeric DEFAULT 120)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.over_qty DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      i.id AS item_id, i.code, i.name, i.item_type, i.uom,
      s.on_hand, s.max_qty,
      CASE WHEN COALESCE(s.avg_daily_demand,0) > 0
           THEN ROUND(s.on_hand / s.avg_daily_demand, 1) END AS days_of_cover,
      CASE WHEN s.max_qty IS NOT NULL AND s.on_hand > s.max_qty
           THEN s.on_hand - s.max_qty END AS over_qty
    FROM public.ppc_stock s
    JOIN public.ppc_items i ON i.id = s.item_id AND i.is_active
    WHERE (s.max_qty IS NOT NULL AND s.on_hand > s.max_qty)
       OR (COALESCE(s.avg_daily_demand,0) > 0 AND s.on_hand / s.avg_daily_demand > p_cover_threshold)
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.ppc_reorder_board() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ppc_excess_stock(numeric) TO authenticated;

COMMIT;

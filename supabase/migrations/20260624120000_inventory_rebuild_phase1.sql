-- =====================================================================
-- Inventory Rebuild — Phase 1: the perpetual stock ledger (foundation)
-- =====================================================================
-- Single source of truth for stock: one append-only ledger; on-hand and
-- value are PROJECTIONS of it. Nothing edits a quantity directly — every
-- change posts a typed, signed movement through a SECURITY DEFINER RPC.
--
-- SAFETY: This migration is PURELY ADDITIVE. It creates new inv_* tables and
-- seeds opening balances into them. It does NOT touch legacy `stock` /
-- `finished_goods`, does NOT touch `ppc_stock`, and rewires NO flow. Fully
-- reversible: drop the inv_* objects.
--
-- Item master = ppc_items (the existing typed registry; one master, shared
-- with BOM/MRP/work-orders). Costing = value-forward: opening stock seeded at
-- ₹0; real value accrues from the next GRN's landed cost (weighted average).
-- =====================================================================

-- ---------- 1. Locations ----------
CREATE TABLE IF NOT EXISTS public.inv_location (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'store'
              CHECK (kind IN ('store','wip','fg','scrap','transit')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.inv_location (code, name, kind) VALUES
  ('STORE',  'Store',            'store'),
  ('COPPER', 'Copper Store',     'store'),
  ('PVC',    'PVC Store',        'store'),
  ('WIP',    'Work in Progress', 'wip'),
  ('FG',     'Finished Goods',   'fg'),
  ('SCRAP',  'Scrap',            'scrap')
ON CONFLICT (code) DO NOTHING;

-- ---------- 2. Stock ledger (append-only spine) ----------
CREATE TABLE IF NOT EXISTS public.inv_ledger (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id         uuid NOT NULL REFERENCES public.ppc_items(id),
  location_id     uuid NOT NULL REFERENCES public.inv_location(id),
  movement_type   text NOT NULL CHECK (movement_type IN (
                    'OPENING','RECEIPT','ISSUE','TRANSFER_IN','TRANSFER_OUT',
                    'MFG_CONSUME','MFG_RECEIVE','DISPATCH','ADJUST',
                    'SCRAP','SCRAP_RECOVER')),
  qty_delta       numeric NOT NULL,            -- signed, in item base UoM
  qty_after       numeric NOT NULL,            -- running on-hand for (item,location)
  incoming_rate   numeric,                     -- landed cost / unit on inbound rows
  valuation_rate  numeric,                     -- running weighted-avg cost after row
  value_delta     numeric,                     -- qty_delta * applicable rate
  value_after     numeric,                     -- running stock value for (item,location)
  ref_type        text,                        -- 'grn' | 'work_order' | 'dispatch' | 'count' | 'manual' | 'transfer'
  ref_id          text,
  reason          text,
  posted_by       text,                        -- email
  posted_at       timestamptz NOT NULL DEFAULT now(),
  is_reversal     boolean NOT NULL DEFAULT false,
  reverses_id     bigint REFERENCES public.inv_ledger(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_item_loc ON public.inv_ledger (item_id, location_id, id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_ref      ON public.inv_ledger (ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_posted   ON public.inv_ledger (posted_at DESC);

-- ---------- 3. Balance projection (cache; rebuildable from ledger) ----------
CREATE TABLE IF NOT EXISTS public.inv_balance (
  item_id         uuid NOT NULL REFERENCES public.ppc_items(id),
  location_id     uuid NOT NULL REFERENCES public.inv_location(id),
  on_hand         numeric NOT NULL DEFAULT 0,
  reserved        numeric NOT NULL DEFAULT 0,
  valuation_rate  numeric NOT NULL DEFAULT 0,
  stock_value     numeric NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, location_id)
);

-- ---------- 4. RLS + grants ----------
-- Reads open to authenticated; writes ONLY through SECURITY DEFINER RPCs
-- (the ledger is never written directly — that is the whole point).
ALTER TABLE public.inv_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_balance  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY inv_location_read ON public.inv_location FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY inv_ledger_read ON public.inv_ledger FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY inv_balance_read ON public.inv_balance FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON public.inv_location, public.inv_ledger, public.inv_balance TO authenticated;
-- NOTE: deliberately NO insert/update/delete grant on inv_ledger/inv_balance to
-- authenticated. All mutation flows through the functions below.

-- =====================================================================
-- 5. Core primitive: post one typed movement (atomic; computes valuation)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.inv_post_movement(
  p_item_id        uuid,
  p_location_id    uuid,
  p_type           text,
  p_qty_delta      numeric,            -- signed
  p_incoming_rate  numeric DEFAULT NULL,
  p_ref_type       text    DEFAULT 'manual',
  p_ref_id         text    DEFAULT NULL,
  p_reason         text    DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_oh    numeric := 0;
  v_rate  numeric := 0;
  v_val   numeric := 0;
  v_new_oh   numeric;
  v_in_rate  numeric;
  v_vd       numeric;   -- value delta
  v_new_val  numeric;
  v_new_rate numeric;
  v_id    bigint;
  v_email text := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', 'system');
BEGIN
  IF p_qty_delta = 0 THEN
    RAISE EXCEPTION 'inv_post_movement: qty_delta cannot be zero';
  END IF;

  -- lock the balance row (or treat as zero if first movement)
  SELECT on_hand, valuation_rate, stock_value INTO v_oh, v_rate, v_val
    FROM public.inv_balance
   WHERE item_id = p_item_id AND location_id = p_location_id
   FOR UPDATE;
  IF NOT FOUND THEN v_oh := 0; v_rate := 0; v_val := 0; END IF;

  v_new_oh := v_oh + p_qty_delta;

  IF v_new_oh < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'inv_post_movement: insufficient stock (on_hand %, delta %) for item % at location %',
      v_oh, p_qty_delta, p_item_id, p_location_id;
  END IF;

  IF p_qty_delta > 0 THEN
    -- inbound: value at incoming rate (fall back to current weighted-avg, then 0)
    v_in_rate  := COALESCE(p_incoming_rate, v_rate, 0);
    v_vd       := p_qty_delta * v_in_rate;
    v_new_val  := v_val + v_vd;
    v_new_rate := CASE WHEN v_new_oh > 0 THEN v_new_val / v_new_oh ELSE v_rate END;
  ELSE
    -- outbound: value at current weighted-avg; rate unchanged
    v_in_rate  := NULL;
    v_vd       := p_qty_delta * v_rate;
    v_new_val  := v_val + v_vd;
    v_new_rate := v_rate;
  END IF;

  INSERT INTO public.inv_ledger(
    item_id, location_id, movement_type, qty_delta, qty_after,
    incoming_rate, valuation_rate, value_delta, value_after,
    ref_type, ref_id, reason, posted_by)
  VALUES(
    p_item_id, p_location_id, p_type, p_qty_delta, v_new_oh,
    v_in_rate, v_new_rate, v_vd, v_new_val,
    p_ref_type, p_ref_id, p_reason, v_email)
  RETURNING id INTO v_id;

  INSERT INTO public.inv_balance(item_id, location_id, on_hand, valuation_rate, stock_value, updated_at)
  VALUES(p_item_id, p_location_id, v_new_oh, v_new_rate, v_new_val, now())
  ON CONFLICT (item_id, location_id) DO UPDATE
    SET on_hand = EXCLUDED.on_hand,
        valuation_rate = EXCLUDED.valuation_rate,
        stock_value = EXCLUDED.stock_value,
        updated_at = now();

  RETURN v_id;
END $$;

-- helper: resolve item code -> id
CREATE OR REPLACE FUNCTION public.inv_item_id(p_code text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.ppc_items WHERE code = p_code LIMIT 1;
$$;

-- helper: resolve location code -> id
CREATE OR REPLACE FUNCTION public.inv_location_id(p_code text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.inv_location WHERE code = p_code LIMIT 1;
$$;

-- =====================================================================
-- 6. Friendly wrappers (resolve by code) — the API the app/RPCs call
-- =====================================================================
CREATE OR REPLACE FUNCTION public.inv_receive(
  p_item_code text, p_location_code text, p_qty numeric,
  p_rate numeric DEFAULT NULL, p_ref_id text DEFAULT NULL, p_ref_type text DEFAULT 'grn')
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    public.inv_item_id(p_item_code), public.inv_location_id(p_location_code),
    'RECEIPT', abs(p_qty), p_rate, p_ref_type, p_ref_id, NULL, false);
$$;

CREATE OR REPLACE FUNCTION public.inv_issue(
  p_item_code text, p_location_code text, p_qty numeric,
  p_ref_id text DEFAULT NULL, p_ref_type text DEFAULT 'work_order')
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    public.inv_item_id(p_item_code), public.inv_location_id(p_location_code),
    'ISSUE', -abs(p_qty), NULL, p_ref_type, p_ref_id, NULL, false);
$$;

CREATE OR REPLACE FUNCTION public.inv_dispatch(
  p_item_code text, p_location_code text, p_qty numeric,
  p_ref_id text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    public.inv_item_id(p_item_code), public.inv_location_id(p_location_code),
    'DISPATCH', -abs(p_qty), NULL, 'dispatch', p_ref_id, NULL, false);
$$;

-- adjust: set on-hand to an absolute counted value (cycle count correction)
CREATE OR REPLACE FUNCTION public.inv_adjust(
  p_item_code text, p_location_code text, p_new_qty numeric, p_reason text DEFAULT 'cycle count')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item uuid; v_loc uuid; v_oh numeric; v_delta numeric;
BEGIN
  v_item := public.inv_item_id(p_item_code);
  v_loc  := public.inv_location_id(p_location_code);
  SELECT COALESCE(on_hand,0) INTO v_oh FROM public.inv_balance WHERE item_id=v_item AND location_id=v_loc;
  v_delta := p_new_qty - COALESCE(v_oh,0);
  IF v_delta = 0 THEN RETURN NULL; END IF;
  RETURN public.inv_post_movement(v_item, v_loc, 'ADJUST', v_delta, NULL, 'count', NULL, p_reason, true);
END $$;

-- transfer: move qty between two locations (two ledger rows, value carried)
CREATE OR REPLACE FUNCTION public.inv_transfer(
  p_item_code text, p_from_code text, p_to_code text, p_qty numeric, p_ref_id text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item uuid; v_from uuid; v_to uuid; v_rate numeric;
BEGIN
  v_item := public.inv_item_id(p_item_code);
  v_from := public.inv_location_id(p_from_code);
  v_to   := public.inv_location_id(p_to_code);
  SELECT COALESCE(valuation_rate,0) INTO v_rate FROM public.inv_balance WHERE item_id=v_item AND location_id=v_from;
  PERFORM public.inv_post_movement(v_item, v_from, 'TRANSFER_OUT', -abs(p_qty), NULL, 'transfer', p_ref_id, NULL, false);
  RETURN  public.inv_post_movement(v_item, v_to,   'TRANSFER_IN',   abs(p_qty), v_rate, 'transfer', p_ref_id, NULL, false);
END $$;

-- opening balance (value-forward: rate defaults to 0)
CREATE OR REPLACE FUNCTION public.inv_open(
  p_item_code text, p_location_code text, p_qty numeric, p_rate numeric DEFAULT 0)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    public.inv_item_id(p_item_code), public.inv_location_id(p_location_code),
    'OPENING', abs(p_qty), p_rate, 'opening', NULL, 'phase-1 opening balance', false);
$$;

-- rebuild the balance cache from the ledger (recovery / verification tool)
CREATE OR REPLACE FUNCTION public.inv_rebuild_balances()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.inv_balance;
  INSERT INTO public.inv_balance(item_id, location_id, on_hand, valuation_rate, stock_value, updated_at)
  SELECT DISTINCT ON (item_id, location_id)
         item_id, location_id, qty_after, COALESCE(valuation_rate,0), COALESCE(value_after,0), now()
    FROM public.inv_ledger
   ORDER BY item_id, location_id, id DESC;
END $$;

GRANT EXECUTE ON FUNCTION
  public.inv_receive(text,text,numeric,numeric,text,text),
  public.inv_issue(text,text,numeric,text,text),
  public.inv_dispatch(text,text,numeric,text),
  public.inv_adjust(text,text,numeric,text),
  public.inv_transfer(text,text,text,numeric,text),
  public.inv_open(text,text,numeric,numeric)
TO authenticated;

-- =====================================================================
-- 7. Opening-balance seed — the 37 real items (value-forward, rate 0)
-- =====================================================================
-- Idempotent: only seeds if no OPENING rows exist yet. Locations mapped from
-- the live data (Store / Copper Store / PVC Store; blanks -> STORE). Only
-- items with on_hand > 0 are seeded (zero-stock items need no opening row).
-- Generic costing codes (COPPER/PVC_INS/... ) are carried as-is for now;
-- item merges happen later in-app per the agreed dedup proposal.
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.inv_ledger WHERE movement_type='OPENING') THEN
    RAISE NOTICE 'inv: opening balances already seeded — skipping';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('WP003', 75040,  'STORE'),
      ('HS015', 130,    'STORE'),
      ('WP002', 290920, 'STORE'),
      ('HS014', 400,    'STORE'),
      ('HS002', 4300,   'STORE'),
      ('HS011', 200,    'STORE'),
      ('HS013', 200,    'STORE'),
      ('HS012', 200,    'STORE'),
      ('HS007', 800,    'STORE'),
      ('HS006', 3000,   'STORE'),
      ('HS005', 2400,   'STORE'),
      ('HS004', 1000,   'STORE'),
      ('WP001', 149586, 'STORE'),
      ('HS008', 4000,   'STORE'),
      ('HS010', 100,    'STORE'),
      ('HS009', 100,    'STORE'),
      ('CO003', 750,    'COPPER'),
      ('CO002', 750,    'COPPER'),
      ('CO001', 750,    'COPPER'),
      ('PV003', 1000,   'PVC'),
      ('ITM001',154000, 'STORE'),
      ('TE003', 21000,  'STORE'),
      ('TE002', 252000, 'STORE'),
      ('PV002', 1000,   'PVC'),
      ('PV001', 1500,   'PVC'),
      ('TE001', 15000,  'STORE'),
      ('TT001', 130,    'STORE')
    ) AS t(code, qty, loc)
  LOOP
    IF public.inv_item_id(r.code) IS NULL THEN
      RAISE NOTICE 'inv: item code % not found in ppc_items — skipped', r.code;
      CONTINUE;
    END IF;
    PERFORM public.inv_open(r.code, r.loc, r.qty, 0);
  END LOOP;

  RAISE NOTICE 'inv: opening balances seeded';
END $$;

-- =====================================================================
-- Verify (run after apply):
--   SELECT l.code, b.on_hand, b.valuation_rate, b.stock_value
--     FROM inv_balance b
--     JOIN ppc_items i ON i.id=b.item_id
--     JOIN inv_location l2 ON l2.id=b.location_id
--   ... (cross-check 27 rows, total on_hand vs the snapshot)
-- Rollback (if needed): DROP the inv_* functions, then inv_balance,
--   inv_ledger, inv_location. No other table is affected.
-- =====================================================================

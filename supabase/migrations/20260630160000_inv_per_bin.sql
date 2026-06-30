-- Inventory Phase 2a — per-bin quantity tracking.
-- Adds a BIN dimension to the perpetual ledger: re-keys inv_balance to
-- (item_id, location_id, bin_id) and makes inv_post_movement + wrappers
-- bin-aware. Bin is OPTIONAL everywhere — callers that pass no bin resolve to a
-- default bin (item home bin, else the location's DEFAULT bin), so mobile / ppc
-- mirrors / bulk-import / kit RPCs keep working UNCHANGED. Readers already sum
-- on_hand across rows, so per-location totals are preserved.
--
-- Base schema: 20260624121000_inventory_rebuild_phase1.sql + 20260624130000
-- (inv_post_by_id) + 20260626080000 (inv_bin / ppc_items.bin_id).
-- Apply via the careful node-pg path (NOT db push) with a _backup_inv_balance
-- snapshot + 0-divergence gate. One transaction.
BEGIN;

-- 1. Add bin_id (nullable for backfill) -------------------------------------
ALTER TABLE public.inv_ledger  ADD COLUMN IF NOT EXISTS bin_id uuid REFERENCES public.inv_bin(id);
ALTER TABLE public.inv_balance ADD COLUMN IF NOT EXISTS bin_id uuid REFERENCES public.inv_bin(id);

-- 2. Seed a DEFAULT bin for every location (idempotent) ---------------------
INSERT INTO public.inv_bin(location_id, bin_code, description, is_active)
SELECT l.id, 'DEFAULT', 'Default bin (unbinned stock)', true
  FROM public.inv_location l
 WHERE NOT EXISTS (SELECT 1 FROM public.inv_bin b WHERE b.location_id = l.id AND b.bin_code = 'DEFAULT');

-- 3. Default-bin resolver: item home bin (iff in this location) else location DEFAULT
CREATE OR REPLACE FUNCTION public.inv_default_bin_id(p_item_id uuid, p_location_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT i.bin_id FROM public.ppc_items i
       JOIN public.inv_bin b ON b.id = i.bin_id
      WHERE i.id = p_item_id AND b.location_id = p_location_id),
    (SELECT id FROM public.inv_bin
      WHERE location_id = p_location_id AND bin_code = 'DEFAULT' LIMIT 1)
  );
$$;

-- 4. Backfill existing rows to their default bin (on_hand unchanged) ---------
UPDATE public.inv_ledger  SET bin_id = public.inv_default_bin_id(item_id, location_id) WHERE bin_id IS NULL;
UPDATE public.inv_balance SET bin_id = public.inv_default_bin_id(item_id, location_id) WHERE bin_id IS NULL;

-- 5. Enforce NOT NULL --------------------------------------------------------
ALTER TABLE public.inv_ledger  ALTER COLUMN bin_id SET NOT NULL;
ALTER TABLE public.inv_balance ALTER COLUMN bin_id SET NOT NULL;

-- 6. Re-key inv_balance PK + ledger running-balance index -------------------
ALTER TABLE public.inv_balance DROP CONSTRAINT inv_balance_pkey;
ALTER TABLE public.inv_balance ADD CONSTRAINT inv_balance_pkey PRIMARY KEY (item_id, location_id, bin_id);
DROP INDEX IF EXISTS public.idx_inv_ledger_item_loc;
CREATE INDEX idx_inv_ledger_item_loc ON public.inv_ledger (item_id, location_id, bin_id, id);

-- 7. Drop the SQL-language wrappers (hard deps) + the signature-changing
--    plpgsql wrappers, then the primitive, so it can be recreated with a bin
--    arg. Kit RPCs are plpgsql/PERFORM (no hard dep) and resolve to the new
--    primitive automatically — left untouched (post to default bin).
DROP FUNCTION IF EXISTS public.inv_receive(text,text,numeric,numeric,text,text);
DROP FUNCTION IF EXISTS public.inv_issue(text,text,numeric,text,text);
DROP FUNCTION IF EXISTS public.inv_dispatch(text,text,numeric,text);
DROP FUNCTION IF EXISTS public.inv_open(text,text,numeric,numeric);
DROP FUNCTION IF EXISTS public.inv_post_by_id(uuid,text,text,numeric,numeric,text,text,text);
DROP FUNCTION IF EXISTS public.inv_adjust(text,text,numeric,text);
DROP FUNCTION IF EXISTS public.inv_transfer(text,text,text,numeric,text);
DROP FUNCTION IF EXISTS public.inv_post_movement(uuid,uuid,text,numeric,numeric,text,text,text,boolean);

-- 8. Recreate the primitive with a trailing optional p_bin_id ---------------
CREATE FUNCTION public.inv_post_movement(
  p_item_id        uuid,
  p_location_id    uuid,
  p_type           text,
  p_qty_delta      numeric,
  p_incoming_rate  numeric DEFAULT NULL,
  p_ref_type       text    DEFAULT 'manual',
  p_ref_id         text    DEFAULT NULL,
  p_reason         text    DEFAULT NULL,
  p_allow_negative boolean DEFAULT false,
  p_bin_id         uuid    DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bin   uuid := COALESCE(p_bin_id, public.inv_default_bin_id(p_item_id, p_location_id));
  v_oh    numeric := 0;
  v_rate  numeric := 0;
  v_val   numeric := 0;
  v_new_oh   numeric;
  v_in_rate  numeric;
  v_vd       numeric;
  v_new_val  numeric;
  v_new_rate numeric;
  v_id    bigint;
  v_email text := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', 'system');
BEGIN
  IF p_qty_delta = 0 THEN
    RAISE EXCEPTION 'inv_post_movement: qty_delta cannot be zero';
  END IF;
  IF v_bin IS NULL THEN
    RAISE EXCEPTION 'inv_post_movement: no bin resolved for item % at location %', p_item_id, p_location_id;
  END IF;

  -- lock the per-(item,location,bin) balance row (or treat as zero if first)
  SELECT on_hand, valuation_rate, stock_value INTO v_oh, v_rate, v_val
    FROM public.inv_balance
   WHERE item_id = p_item_id AND location_id = p_location_id AND bin_id = v_bin
   FOR UPDATE;
  IF NOT FOUND THEN v_oh := 0; v_rate := 0; v_val := 0; END IF;

  v_new_oh := v_oh + p_qty_delta;
  IF v_new_oh < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'inv_post_movement: insufficient stock (on_hand %, delta %) for item % at location % bin %',
      v_oh, p_qty_delta, p_item_id, p_location_id, v_bin;
  END IF;

  IF p_qty_delta > 0 THEN
    v_in_rate  := COALESCE(p_incoming_rate, v_rate, 0);
    v_vd       := p_qty_delta * v_in_rate;
    v_new_val  := v_val + v_vd;
    v_new_rate := CASE WHEN v_new_oh > 0 THEN v_new_val / v_new_oh ELSE v_rate END;
  ELSE
    v_in_rate  := NULL;
    v_vd       := p_qty_delta * v_rate;
    v_new_val  := v_val + v_vd;
    v_new_rate := v_rate;
  END IF;

  INSERT INTO public.inv_ledger(
    item_id, location_id, bin_id, movement_type, qty_delta, qty_after,
    incoming_rate, valuation_rate, value_delta, value_after,
    ref_type, ref_id, reason, posted_by)
  VALUES(
    p_item_id, p_location_id, v_bin, p_type, p_qty_delta, v_new_oh,
    v_in_rate, v_new_rate, v_vd, v_new_val,
    p_ref_type, p_ref_id, p_reason, v_email)
  RETURNING id INTO v_id;

  INSERT INTO public.inv_balance(item_id, location_id, bin_id, on_hand, valuation_rate, stock_value, updated_at)
  VALUES(p_item_id, p_location_id, v_bin, v_new_oh, v_new_rate, v_new_val, now())
  ON CONFLICT (item_id, location_id, bin_id) DO UPDATE
    SET on_hand = EXCLUDED.on_hand,
        valuation_rate = EXCLUDED.valuation_rate,
        stock_value = EXCLUDED.stock_value,
        updated_at = now();

  RETURN v_id;
END $$;

-- 9. Recreate wrappers with an optional trailing bin code -------------------
-- code-keyed bin resolver (null code -> null -> primitive resolves default)
CREATE OR REPLACE FUNCTION public.inv_bin_id(p_location_code text, p_bin_code text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT b.id FROM public.inv_bin b
    JOIN public.inv_location l ON l.id = b.location_id
   WHERE l.code = p_location_code AND b.bin_code = p_bin_code LIMIT 1;
$$;

CREATE FUNCTION public.inv_receive(
  p_item_code text, p_location_code text, p_qty numeric,
  p_rate numeric DEFAULT NULL, p_ref_id text DEFAULT NULL, p_ref_type text DEFAULT 'grn',
  p_bin_code text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    public.inv_item_id(p_item_code), public.inv_location_id(p_location_code),
    'RECEIPT', abs(p_qty), p_rate, p_ref_type, p_ref_id, NULL, false,
    CASE WHEN p_bin_code IS NULL THEN NULL ELSE public.inv_bin_id(p_location_code, p_bin_code) END);
$$;

CREATE FUNCTION public.inv_issue(
  p_item_code text, p_location_code text, p_qty numeric,
  p_ref_id text DEFAULT NULL, p_ref_type text DEFAULT 'work_order',
  p_bin_code text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    public.inv_item_id(p_item_code), public.inv_location_id(p_location_code),
    'ISSUE', -abs(p_qty), NULL, p_ref_type, p_ref_id, NULL, false,
    CASE WHEN p_bin_code IS NULL THEN NULL ELSE public.inv_bin_id(p_location_code, p_bin_code) END);
$$;

CREATE FUNCTION public.inv_dispatch(
  p_item_code text, p_location_code text, p_qty numeric,
  p_ref_id text DEFAULT NULL, p_bin_code text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    public.inv_item_id(p_item_code), public.inv_location_id(p_location_code),
    'DISPATCH', -abs(p_qty), NULL, 'dispatch', p_ref_id, NULL, false,
    CASE WHEN p_bin_code IS NULL THEN NULL ELSE public.inv_bin_id(p_location_code, p_bin_code) END);
$$;

-- adjust: set on-hand at a specific bin to an absolute counted value
CREATE FUNCTION public.inv_adjust(
  p_item_code text, p_location_code text, p_new_qty numeric, p_reason text DEFAULT 'cycle count',
  p_bin_code text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item uuid; v_loc uuid; v_bin uuid; v_oh numeric; v_delta numeric;
BEGIN
  v_item := public.inv_item_id(p_item_code);
  v_loc  := public.inv_location_id(p_location_code);
  v_bin  := COALESCE(
    CASE WHEN p_bin_code IS NULL THEN NULL ELSE public.inv_bin_id(p_location_code, p_bin_code) END,
    public.inv_default_bin_id(v_item, v_loc));
  SELECT COALESCE(on_hand,0) INTO v_oh FROM public.inv_balance
    WHERE item_id=v_item AND location_id=v_loc AND bin_id=v_bin;
  v_delta := p_new_qty - COALESCE(v_oh,0);
  IF v_delta = 0 THEN RETURN NULL; END IF;
  RETURN public.inv_post_movement(v_item, v_loc, 'ADJUST', v_delta, NULL, 'count', NULL, p_reason, true, v_bin);
END $$;

-- transfer: move qty location->location and/or bin->bin (value carried)
CREATE FUNCTION public.inv_transfer(
  p_item_code text, p_from_code text, p_to_code text, p_qty numeric, p_ref_id text DEFAULT NULL,
  p_from_bin_code text DEFAULT NULL, p_to_bin_code text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item uuid; v_from uuid; v_to uuid; v_from_bin uuid; v_to_bin uuid; v_rate numeric;
BEGIN
  v_item := public.inv_item_id(p_item_code);
  v_from := public.inv_location_id(p_from_code);
  v_to   := public.inv_location_id(p_to_code);
  v_from_bin := COALESCE(
    CASE WHEN p_from_bin_code IS NULL THEN NULL ELSE public.inv_bin_id(p_from_code, p_from_bin_code) END,
    public.inv_default_bin_id(v_item, v_from));
  v_to_bin := COALESCE(
    CASE WHEN p_to_bin_code IS NULL THEN NULL ELSE public.inv_bin_id(p_to_code, p_to_bin_code) END,
    public.inv_default_bin_id(v_item, v_to));
  SELECT COALESCE(valuation_rate,0) INTO v_rate FROM public.inv_balance
    WHERE item_id=v_item AND location_id=v_from AND bin_id=v_from_bin;
  PERFORM public.inv_post_movement(v_item, v_from, 'TRANSFER_OUT', -abs(p_qty), NULL, 'transfer', p_ref_id, NULL, false, v_from_bin);
  RETURN  public.inv_post_movement(v_item, v_to,   'TRANSFER_IN',   abs(p_qty), v_rate, 'transfer', p_ref_id, NULL, false, v_to_bin);
END $$;

CREATE FUNCTION public.inv_open(
  p_item_code text, p_location_code text, p_qty numeric, p_rate numeric DEFAULT 0,
  p_bin_code text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    public.inv_item_id(p_item_code), public.inv_location_id(p_location_code),
    'OPENING', abs(p_qty), p_rate, 'opening', NULL, 'phase-1 opening balance', false,
    CASE WHEN p_bin_code IS NULL THEN NULL ELSE public.inv_bin_id(p_location_code, p_bin_code) END);
$$;

CREATE FUNCTION public.inv_post_by_id(
  p_item_id uuid, p_location_code text, p_type text, p_qty_delta numeric,
  p_rate numeric DEFAULT NULL, p_ref_type text DEFAULT 'ppc', p_ref_id text DEFAULT NULL,
  p_reason text DEFAULT NULL, p_bin_id uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_post_movement(
    p_item_id, public.inv_location_id(p_location_code), p_type, p_qty_delta,
    p_rate, p_ref_type, p_ref_id, p_reason, true, p_bin_id);
$$;

-- 10. Recreate the rebuild tool with per-bin grouping -----------------------
CREATE OR REPLACE FUNCTION public.inv_rebuild_balances()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.inv_balance;
  INSERT INTO public.inv_balance(item_id, location_id, bin_id, on_hand, valuation_rate, stock_value, updated_at)
  SELECT DISTINCT ON (item_id, location_id, bin_id)
         item_id, location_id, bin_id, qty_after, COALESCE(valuation_rate,0), COALESCE(value_after,0), now()
    FROM public.inv_ledger
   ORDER BY item_id, location_id, bin_id, id DESC;
END $$;

-- 11. Re-grant execute -------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  public.inv_receive(text,text,numeric,numeric,text,text,text),
  public.inv_issue(text,text,numeric,text,text,text),
  public.inv_dispatch(text,text,numeric,text,text),
  public.inv_adjust(text,text,numeric,text,text),
  public.inv_transfer(text,text,text,numeric,text,text,text),
  public.inv_open(text,text,numeric,numeric,text),
  public.inv_post_by_id(uuid,text,text,numeric,numeric,text,text,text,uuid),
  public.inv_default_bin_id(uuid,uuid),
  public.inv_bin_id(text,text)
TO authenticated;

COMMIT;

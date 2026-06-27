-- RLS hardening — Slice 4: inventory.
-- The perpetual tables inv_balance/inv_ledger already have ONLY a read policy
-- (writes locked to the inv_post_movement SECURITY DEFINER RPC) — left as-is;
-- their reads stay broad because stock is read cross-module (production, dispatch,
-- sales, PPC). The genuinely wide-open (read+write USING true) tables are inv_bin,
-- inv_uom_conversion, inv_reservations. Keep their reads broad (operational/ref
-- data) but gate WRITES to the inventory module. inv_bin + inv_uom_conversion are
-- written by inventoryUomBinService (the inventory Bin/UoM screen); inv_reservations
-- has no direct client writer (definer-only). + is_super_admin bypass. Idempotent.

-- Bin master ------------------------------------------------------------------
DROP POLICY IF EXISTS inv_bin_all ON public.inv_bin;
DROP POLICY IF EXISTS inv_bin_read ON public.inv_bin;
DROP POLICY IF EXISTS inv_bin_write ON public.inv_bin;
CREATE POLICY inv_bin_read ON public.inv_bin FOR SELECT TO authenticated USING (true);
CREATE POLICY inv_bin_write ON public.inv_bin FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('inventory','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('inventory','edit'));

-- UoM conversions -------------------------------------------------------------
DROP POLICY IF EXISTS inv_uom_conversion_all ON public.inv_uom_conversion;
DROP POLICY IF EXISTS inv_uom_conversion_read ON public.inv_uom_conversion;
DROP POLICY IF EXISTS inv_uom_conversion_write ON public.inv_uom_conversion;
CREATE POLICY inv_uom_conversion_read ON public.inv_uom_conversion FOR SELECT TO authenticated USING (true);
CREATE POLICY inv_uom_conversion_write ON public.inv_uom_conversion FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('inventory','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('inventory','edit'));

-- Stock reservations ----------------------------------------------------------
DROP POLICY IF EXISTS invres_all ON public.inv_reservations;
DROP POLICY IF EXISTS inv_reservations_read ON public.inv_reservations;
DROP POLICY IF EXISTS inv_reservations_write ON public.inv_reservations;
CREATE POLICY inv_reservations_read ON public.inv_reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY inv_reservations_write ON public.inv_reservations FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('inventory','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('inventory','edit'));

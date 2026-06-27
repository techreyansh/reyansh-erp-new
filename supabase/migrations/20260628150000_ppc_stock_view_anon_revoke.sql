-- RLS hardening — Slice 7b: close the ppc_stock compat-view anon leak.
--
-- ppc_stock (created 20260627140000) is a VIEW over ppc_items + aggregated
-- inventory balances exposing per-item stock levels. As a view it can't carry an
-- RLS policy, so Slice 7's relkind guard skipped it — and being a non-
-- security_invoker view created with a default anon grant, anon could read it
-- (verified: HTTP 200). It is not read directly by the app (no from('ppc_stock')).
--
-- Minimal fix: REVOKE the anon table grant so anon is denied at the grant layer
-- (authenticated reads are unchanged — the view still runs as owner, and stock
-- levels are broad-read for logged-in users, consistent with the Slice 4
-- inventory decision). security_invoker is intentionally NOT set here to avoid
-- imposing new base-table grant requirements on the view's aggregation source.
DO $$
BEGIN
  IF (SELECT c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'ppc_stock') = 'v' THEN
    EXECUTE 'REVOKE ALL ON public.ppc_stock FROM anon';
  END IF;
END $$;

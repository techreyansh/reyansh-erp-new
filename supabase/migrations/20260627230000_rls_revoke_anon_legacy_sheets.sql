-- RLS hardening — Slice 5: revoke UNAUTHENTICATED (anon) access to ~59 legacy
-- sheet tables.
-- The "Allow all anon" policies (from 20250223100000) were created `TO public`,
-- which includes the anon role — so the public anon key (embedded in the frontend
-- bundle) could read these tables WITHOUT logging in. Verified live: anon read
-- clients2=85, costing_data, client_payments_data, employees_data_legacy,
-- audit_log. Close it: replace every `TO public` "Allow all anon" policy with an
-- authenticated-only one (keep USING(true) so the logged-in app is unaffected —
-- the app always reads as the authenticated role). Anon then has no matching
-- policy → denied. Dynamic (covers all such policies). Idempotent + re-runnable.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'Allow all anon' AND roles::text = '{public}'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow all anon" ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all authenticated" ON public.%I', r.tablename);
    EXECUTE format(
      'CREATE POLICY "Allow all authenticated" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      r.tablename);
    -- defense-in-depth: drop the anon role's table grant so it can't reach the table at all
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.tablename);
  END LOOP;
END $$;

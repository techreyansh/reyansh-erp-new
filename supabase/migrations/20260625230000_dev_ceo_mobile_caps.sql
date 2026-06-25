-- DEV/TEST CONVENIENCE — grant the CEO role the mobile capabilities so the owner
-- can open /app and exercise the Store + demo screens without reassigning their
-- role. get_my_capabilities() does NOT auto-grant super-admins, so a CEO sees the
-- module tiles (via get_my_rbac_access super-admin) but no capability-gated screens
-- until caps exist for role_code 'CEO'. Additive + idempotent.
--
-- REMOVE when done testing:
--   DELETE FROM public.mobile_role_capabilities WHERE role_code = 'CEO';

INSERT INTO public.mobile_role_capabilities (role_code, capability)
SELECT 'CEO', cap
FROM (VALUES ('store.issue'),('store.receipt'),('store.adjust'),
             ('store.transfer'),('store.scan'),('store.lookup'),
             ('demo.submit')) AS c(cap)
ON CONFLICT (role_code, capability) DO NOTHING;

DO $$ DECLARE v int; BEGIN
  SELECT count(*) INTO v FROM public.mobile_role_capabilities WHERE role_code = 'CEO';
  RAISE NOTICE 'dev_ceo_mobile_caps: CEO now holds % mobile capabilities.', v;
END $$;

-- Self-service profile editing: photo column + storage buckets + policies.
BEGIN;

-- 1) Profile photo URL on the HR master.
ALTER TABLE public.employees_data ADD COLUMN IF NOT EXISTS "ProfilePhoto" text;

-- 2) Storage buckets: public 'avatars' for profile pictures; private 'documents'
--    (db.uploadFile already targets 'documents' but it never existed).
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- 3) RLS policies on storage.objects (guarded — skip cleanly if not owner).
DO $$
BEGIN
  -- avatars: public read, authenticated write/update/delete
  DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
  CREATE POLICY "avatars_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');

  DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
  CREATE POLICY "avatars_auth_insert" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');

  DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
  CREATE POLICY "avatars_auth_update" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'avatars');

  DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;
  CREATE POLICY "avatars_auth_delete" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'avatars');

  -- documents: authenticated full access (private bucket)
  DROP POLICY IF EXISTS "documents_auth_all" ON storage.objects;
  CREATE POLICY "documents_auth_all" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'documents') WITH CHECK (bucket_id = 'documents');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'storage.objects policy creation skipped (insufficient privilege) — set via dashboard';
END$$;

COMMIT;

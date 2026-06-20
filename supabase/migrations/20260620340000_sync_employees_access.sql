-- Unify Employee Dashboard (employees_data, HR profile) with Employee Access
-- Management (public.employees, the RBAC/login source get_my_rbac_access reads).
-- Bidirectional, depth-guarded triggers keep them identical by email; creating
-- an employee auto-provisions ERP access (default dashboard + tasks view).
-- One-time backfill converges the existing lists.
BEGIN;

-- helper: is a Status string "active"?
CREATE OR REPLACE FUNCTION public._emp_status_active(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_status,'Active') NOT IN ('Inactive','Resigned','Terminated','Left','Disabled','Suspended','Ex-Employee');
$$;

-- A) employees_data (Dashboard) -> public.employees (Access) + default perms.
CREATE OR REPLACE FUNCTION public.sync_employees_data_to_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text; v_id uuid; v_new boolean;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;             -- break the loop
  v_email := lower(trim(NEW."Email"));
  IF v_email IS NULL OR v_email = '' THEN RETURN NEW; END IF;
  INSERT INTO public.employees (email, full_name, phone, department, is_active)
  VALUES (v_email, NEW."EmployeeName", NEW."Phone", NEW."Department", public._emp_status_active(NEW."Status"))
  ON CONFLICT (email) DO UPDATE SET
    full_name  = COALESCE(EXCLUDED.full_name, public.employees.full_name),
    phone      = COALESCE(EXCLUDED.phone, public.employees.phone),
    department = COALESCE(EXCLUDED.department, public.employees.department),
    is_active  = EXCLUDED.is_active,
    updated_at = now()
  RETURNING id, (xmax = 0) INTO v_id, v_new;
  IF v_new THEN  -- newly provisioned -> grant baseline ERP access
    INSERT INTO public.employee_permissions (employee_id, module_id, can_view, can_create, can_edit, can_delete)
    SELECT v_id, m.id, true, false, false, false
    FROM public.modules m WHERE m.module_key IN ('dashboard','tasks')
    ON CONFLICT (employee_id, module_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_employees_data_to_access ON public.employees_data;
CREATE TRIGGER trg_sync_employees_data_to_access
  AFTER INSERT OR UPDATE ON public.employees_data
  FOR EACH ROW EXECUTE FUNCTION public.sync_employees_data_to_access();

-- B) public.employees (Access) -> employees_data (Dashboard), so anyone added in
--    Access Management appears in the Employee Dashboard too.
CREATE OR REPLACE FUNCTION public.sync_access_to_employees_data()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;             -- break the loop
  v_email := lower(trim(NEW.email));
  IF v_email IS NULL OR v_email = '' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.employees_data WHERE lower(trim("Email")) = v_email) THEN
    UPDATE public.employees_data SET
      "EmployeeName" = COALESCE("EmployeeName", NEW.full_name),
      "Phone"        = COALESCE("Phone", NEW.phone),
      "Department"   = COALESCE(NEW.department, "Department"),
      "Status"       = CASE WHEN NEW.is_active THEN 'Active' ELSE 'Inactive' END,
      "UpdatedAt"    = now()
    WHERE lower(trim("Email")) = v_email;
  ELSE
    INSERT INTO public.employees_data ("EmployeeCode","EmployeeName","Email","Phone","Department","Status","EmployeeType")
    VALUES ('EMP-'||upper(substr(md5(v_email),1,6)), NEW.full_name, v_email, NEW.phone, NEW.department,
            CASE WHEN NEW.is_active THEN 'Active' ELSE 'Inactive' END, 'Full-time');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_access_to_employees_data ON public.employees;
CREATE TRIGGER trg_sync_access_to_employees_data
  AFTER INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.sync_access_to_employees_data();

-- C) One-time backfill, both directions, to converge the existing lists.
--    C1: every Dashboard employee -> Access (+ baseline perms for new ones).
WITH up AS (
  INSERT INTO public.employees (email, full_name, phone, department, is_active)
  SELECT DISTINCT ON (lower(trim("Email"))) lower(trim("Email")), "EmployeeName", "Phone", "Department",
         public._emp_status_active("Status")
  FROM public.employees_data WHERE "Email" IS NOT NULL AND trim("Email") <> ''
  ON CONFLICT (email) DO UPDATE SET
    full_name = COALESCE(public.employees.full_name, EXCLUDED.full_name),
    phone     = COALESCE(public.employees.phone, EXCLUDED.phone),
    department= COALESCE(public.employees.department, EXCLUDED.department),
    updated_at= now()
  RETURNING id
)
INSERT INTO public.employee_permissions (employee_id, module_id, can_view, can_create, can_edit, can_delete)
SELECT up.id, m.id, true, false, false, false
FROM up CROSS JOIN public.modules m WHERE m.module_key IN ('dashboard','tasks')
ON CONFLICT (employee_id, module_id) DO NOTHING;

--    C2: every Access employee missing from the Dashboard -> create an HR record.
INSERT INTO public.employees_data ("EmployeeCode","EmployeeName","Email","Phone","Department","Status","EmployeeType")
SELECT 'EMP-'||upper(substr(md5(lower(trim(e.email))),1,6)), e.full_name, lower(trim(e.email)), e.phone,
       e.department, CASE WHEN e.is_active THEN 'Active' ELSE 'Inactive' END, 'Full-time'
FROM public.employees e
WHERE e.email IS NOT NULL AND trim(e.email) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.employees_data d WHERE lower(trim(d."Email")) = lower(trim(e.email)));

COMMIT;

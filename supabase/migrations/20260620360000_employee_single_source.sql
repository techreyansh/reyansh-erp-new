-- PART A: make public.employees the SINGLE employee master.
-- employees_data becomes a read/write COMPAT VIEW over public.employees so every
-- existing reader (db.js, ProfilePage, Header avatar, crm/task assignable RPCs,
-- accountabilityService) keeps working against the one master. Delete now
-- cascades to employee_permissions (FK already ON DELETE CASCADE) -> no orphans.
BEGIN;

-- 1) Widen public.employees with the HR/profile fields employees_data carried.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_code text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS designation text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_type text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS joining_date text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS date_of_birth text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS reporting_manager text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS reporting_manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS salary_grade text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS highest_qualification text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS university text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS graduation_year integer;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS specialization text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS experience text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS skills text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS certifications text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS upi_id text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS ifsc_code text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS bank_branch text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS account_holder_name text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS profile_photo text;

-- future-ready documents
CREATE TABLE IF NOT EXISTS public.employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  doc_type text, file_name text, storage_path text,
  uploaded_by_email text, created_at timestamptz DEFAULT now()
);
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_documents_all ON public.employee_documents;
CREATE POLICY employee_documents_all ON public.employee_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Backfill HR fields from the current employees_data table (by email).
UPDATE public.employees e SET
  employee_code        = COALESCE(e.employee_code, d."EmployeeCode"),
  designation          = COALESCE(e.designation, d."Designation"),
  employment_type      = COALESCE(e.employment_type, d."EmployeeType"),
  joining_date         = COALESCE(e.joining_date, d."JoiningDate"::text),
  date_of_birth        = COALESCE(e.date_of_birth, d."DateOfBirth"::text),
  address              = COALESCE(e.address, d."Address"),
  reporting_manager    = COALESCE(e.reporting_manager, d."ReportingManager"),
  salary_grade         = COALESCE(e.salary_grade, d."SalaryGrade"),
  status               = COALESCE(e.status, d."Status", CASE WHEN e.is_active THEN 'Active' ELSE 'Inactive' END),
  highest_qualification= COALESCE(e.highest_qualification, d."HighestQualification"),
  university           = COALESCE(e.university, d."University"),
  graduation_year      = COALESCE(e.graduation_year, d."GraduationYear"),
  specialization       = COALESCE(e.specialization, d."Specialization"),
  experience           = COALESCE(e.experience, d."Experience"),
  skills               = COALESCE(e.skills, d."Skills"),
  certifications       = COALESCE(e.certifications, d."Certifications"),
  upi_id               = COALESCE(e.upi_id, d."UpiId"),
  bank_name            = COALESCE(e.bank_name, d."BankName"),
  account_number       = COALESCE(e.account_number, d."AccountNumber"),
  ifsc_code            = COALESCE(e.ifsc_code, d."IfscCode"),
  bank_branch          = COALESCE(e.bank_branch, d."BankBranch"),
  account_holder_name  = COALESCE(e.account_holder_name, d."AccountHolderName"),
  profile_photo        = COALESCE(e.profile_photo, d."ProfilePhoto")
FROM public.employees_data d
WHERE lower(trim(d."Email")) = lower(trim(e.email));
UPDATE public.employees SET status = CASE WHEN is_active THEN 'Active' ELSE 'Inactive' END WHERE status IS NULL;

-- 3) Remove the old bidirectional sync triggers (the view replaces them).
DROP TRIGGER IF EXISTS trg_sync_employees_data_to_access ON public.employees_data;
DROP TRIGGER IF EXISTS trg_sync_access_to_employees_data ON public.employees;
DROP FUNCTION IF EXISTS public.sync_employees_data_to_access();
DROP FUNCTION IF EXISTS public.sync_access_to_employees_data();

-- 4) Retire the table; replace with a read/write compat VIEW over the master.
ALTER TABLE public.employees_data RENAME TO employees_data_legacy;

CREATE VIEW public.employees_data AS
SELECT
  e.id,
  e.employee_code        AS "EmployeeCode",
  e.full_name            AS "EmployeeName",
  e.email                AS "Email",
  e.phone                AS "Phone",
  e.date_of_birth        AS "DateOfBirth",
  e.address              AS "Address",
  e.department           AS "Department",
  e.designation          AS "Designation",
  e.employment_type      AS "EmployeeType",
  e.joining_date         AS "JoiningDate",
  e.reporting_manager    AS "ReportingManager",
  e.salary_grade         AS "SalaryGrade",
  e.status               AS "Status",
  e.highest_qualification AS "HighestQualification",
  e.university           AS "University",
  e.graduation_year      AS "GraduationYear",
  e.specialization       AS "Specialization",
  e.experience           AS "Experience",
  e.skills               AS "Skills",
  e.certifications       AS "Certifications",
  e.employee_code        AS "EmployeeId",
  e.upi_id               AS "UpiId",
  e.bank_name            AS "BankName",
  e.account_number       AS "AccountNumber",
  e.ifsc_code            AS "IfscCode",
  e.bank_branch          AS "BankBranch",
  e.account_holder_name  AS "AccountHolderName",
  e.profile_photo        AS "ProfilePhoto",
  e.created_at           AS "CreatedAt",
  e.updated_at           AS "UpdatedAt",
  e.created_at
FROM public.employees e;

-- 5) INSTEAD OF triggers: writes to the view land on public.employees.
CREATE OR REPLACE FUNCTION public.employees_data_view_dml()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.employees (
      email, full_name, phone, department, designation, employment_type, joining_date,
      date_of_birth, address, reporting_manager, salary_grade, status, is_active,
      highest_qualification, university, graduation_year, specialization, experience,
      skills, certifications, employee_code, upi_id, bank_name, account_number,
      ifsc_code, bank_branch, account_holder_name, profile_photo)
    VALUES (
      lower(trim(NEW."Email")), NEW."EmployeeName", NEW."Phone", NEW."Department", NEW."Designation",
      NEW."EmployeeType", NEW."JoiningDate", NEW."DateOfBirth", NEW."Address", NEW."ReportingManager",
      NEW."SalaryGrade", COALESCE(NEW."Status",'Active'), public._emp_status_active(NEW."Status"),
      NEW."HighestQualification", NEW."University", NEW."GraduationYear", NEW."Specialization", NEW."Experience",
      NEW."Skills", NEW."Certifications", COALESCE(NEW."EmployeeCode", NEW."EmployeeId"), NEW."UpiId",
      NEW."BankName", NEW."AccountNumber", NEW."IfscCode", NEW."BankBranch", NEW."AccountHolderName", NEW."ProfilePhoto")
    ON CONFLICT (email) DO UPDATE SET
      full_name=EXCLUDED.full_name, phone=EXCLUDED.phone, department=EXCLUDED.department,
      designation=EXCLUDED.designation, profile_photo=COALESCE(EXCLUDED.profile_photo, public.employees.profile_photo),
      updated_at=now();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.employees SET
      full_name=NEW."EmployeeName", email=lower(trim(NEW."Email")), phone=NEW."Phone",
      department=NEW."Department", designation=NEW."Designation", employment_type=NEW."EmployeeType",
      joining_date=NEW."JoiningDate", date_of_birth=NEW."DateOfBirth", address=NEW."Address",
      reporting_manager=NEW."ReportingManager", salary_grade=NEW."SalaryGrade",
      status=NEW."Status", is_active=public._emp_status_active(NEW."Status"),
      highest_qualification=NEW."HighestQualification", university=NEW."University", graduation_year=NEW."GraduationYear",
      specialization=NEW."Specialization", experience=NEW."Experience", skills=NEW."Skills",
      certifications=NEW."Certifications", employee_code=COALESCE(NEW."EmployeeCode", NEW."EmployeeId"),
      upi_id=NEW."UpiId", bank_name=NEW."BankName", account_number=NEW."AccountNumber", ifsc_code=NEW."IfscCode",
      bank_branch=NEW."BankBranch", account_holder_name=NEW."AccountHolderName", profile_photo=NEW."ProfilePhoto",
      updated_at=now()
    WHERE id = OLD.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.employees WHERE id = OLD.id;   -- cascades employee_permissions
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_employees_data_view_ins INSTEAD OF INSERT ON public.employees_data FOR EACH ROW EXECUTE FUNCTION public.employees_data_view_dml();
CREATE TRIGGER trg_employees_data_view_upd INSTEAD OF UPDATE ON public.employees_data FOR EACH ROW EXECUTE FUNCTION public.employees_data_view_dml();
CREATE TRIGGER trg_employees_data_view_del INSTEAD OF DELETE ON public.employees_data FOR EACH ROW EXECUTE FUNCTION public.employees_data_view_dml();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees_data TO authenticated;

COMMIT;

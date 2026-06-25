-- Set up the 4 real users with names, departments and correct roles so CRM
-- lead assignment shows a person's NAME (not an email prefix) and the lead
-- lands on that person's dashboard. Names stay editable later via /profile
-- (employees_data.EmployeeName), which this RPC prefers.
BEGIN;

-- 1) Names + correct roles on public.users (auth/RBAC).
UPDATE public.users SET full_name = 'Abhishek'
 WHERE lower(email) = 'abhishek@reyanshelectronics.com' AND COALESCE(full_name,'') = '';
UPDATE public.users SET full_name = 'Dolly Nigam', role_id = 'c8ee453f-428e-4de5-a627-17eb9a63b975'  -- CRM
 WHERE lower(email) = 'crmripl49@gmail.com';
UPDATE public.users SET full_name = 'Vikram'
 WHERE lower(email) = 'salesreyansh63@gmail.com' AND COALESCE(full_name,'') = '';
UPDATE public.users SET full_name = 'Dolly Kashyap', role_id = '0c0be34a-005c-479b-a699-f0afcbb2f03a'  -- PC
 WHERE lower(email) = 'pcripl51@gmail.com';

-- 2) Employee records (name + DEPARTMENT) so they appear in HR + are profile-editable.
INSERT INTO public.employees_data ("EmployeeName","Email","Department","Designation","Status","EmployeeCode")
SELECT v.name, v.email, v.dept, v.desig, 'Active', v.code
FROM (VALUES
  ('Abhishek',     'abhishek@reyanshelectronics.com', 'Management', 'CEO',                         'EMP-MGMT01'),
  ('Dolly Nigam',  'crmripl49@gmail.com',             'Sales',      'Customer Relations Manager',  'EMP-CRM01'),
  ('Vikram',       'salesreyansh63@gmail.com',        'Sales',      'Sales Executive',             'EMP-SAL01'),
  ('Dolly Kashyap','pcripl51@gmail.com',              'Operations', 'Process Coordinator',         'EMP-OPS01')
) AS v(name,email,dept,desig,code)
WHERE NOT EXISTS (
  SELECT 1 FROM public.employees_data e WHERE lower(e."Email") = lower(v.email)
);

-- keep department/designation current if the row already existed but lacked them
UPDATE public.employees_data e SET "Department" = v.dept, "Designation" = v.desig
FROM (VALUES
  ('abhishek@reyanshelectronics.com','Management','CEO'),
  ('crmripl49@gmail.com','Sales','Customer Relations Manager'),
  ('salesreyansh63@gmail.com','Sales','Sales Executive'),
  ('pcripl51@gmail.com','Operations','Process Coordinator')
) AS v(email,dept,desig)
WHERE lower(e."Email") = v.email AND COALESCE(e."Department",'') = '';

-- 3) Keep MIS roster names in sync where present.
UPDATE public.acc_employees a SET full_name = u.full_name
FROM public.users u
WHERE lower(a.email) = lower(u.email)
  AND lower(u.email) IN ('abhishek@reyanshelectronics.com','crmripl49@gmail.com','salesreyansh63@gmail.com','pcripl51@gmail.com')
  AND COALESCE(u.full_name,'') <> '';

-- 4) Assignable-users list for the CRM person-picker + name resolution.
--    Prefers the profile-editable employees_data.EmployeeName, then users.full_name.
CREATE OR REPLACE FUNCTION public.crm_assignable_users()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.full_name), '[]'::jsonb)
  FROM (
    SELECT
      lower(u.email) AS email,
      COALESCE(NULLIF(e."EmployeeName",''), NULLIF(u.full_name,''), split_part(u.email,'@',1)) AS full_name,
      COALESCE(e."Department", r.name) AS department,
      r.name AS role
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
    LEFT JOIN public.employees_data e ON lower(e."Email") = lower(u.email)
    WHERE u.is_active IS NOT FALSE
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.crm_assignable_users() TO authenticated;

COMMIT;

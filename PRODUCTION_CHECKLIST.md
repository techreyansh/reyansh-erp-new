# ERP Production QA Checklist

Use this checklist before and after deploying to production (Vercel + Supabase).

**Prerequisites**

- [ ] `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` set in Vercel
- [ ] Supabase Google OAuth redirect URLs include production domain and `http://localhost:3000`
- [ ] SQL applied in order: `supabase_rbac_setup.sql` → `erp_rbac_tasks_complete.sql` → `database_audit.sql` (optional validation)
- [ ] CEO employee row exists with full module permissions in `employee_permissions`

---

## CEO Flow

### Login

- [ ] Open `/login`, sign in with Google
- [ ] Redirect lands on `/welcome` or home without blank screen
- [ ] Browser console has no red errors (production build)
- [ ] Refresh page keeps session (no forced re-login)

### Access management

- [ ] Navigate to `/access-management` (requires employees **edit**)
- [ ] List loads employees, roles, modules
- [ ] Assign department + role to employee
- [ ] Toggle module permissions (view/create/edit/delete)
- [ ] Save persists after refresh
- [ ] Employee without edit cannot open `/access-management` (redirect to access denied)

### Task assignment

- [ ] Open `/task-scheduler` (requires tasks **create**)
- [ ] Select department → employee list filters
- [ ] Create task for one employee
- [ ] Create task for whole department (bulk)
- [ ] Task appears in `/team-tasks` with correct assignee name/email

### Employee visibility (CEO tracking)

- [ ] Open `/team-tasks` (requires tasks **edit**)
- [ ] Filter/search tasks
- [ ] Edit task fields (title, priority, due date, status)
- [ ] Delete task (if delete permission granted)

---

## Employee Flow

### Login

- [ ] Employee Google account exists in `employees` with `is_active = true`
- [ ] Login succeeds; unauthorized email shows access denied with clear message

### Dashboard

- [ ] Lands on allowed home/dashboard route
- [ ] Sidebar/header shows only permitted modules
- [ ] No flash of full menu before permissions load (skeleton or loading state)

### Task visibility

- [ ] Open `/my-tasks`
- [ ] Sees only tasks where `assigned_email` matches login email
- [ ] Can change status (pending → in_progress → completed)
- [ ] Cannot edit title/assignee/delete (unless granted edit/delete)
- [ ] Overdue tasks highlighted when applicable

### Restricted access

- [ ] Direct URL to `/task-scheduler` denied without create permission
- [ ] Direct URL to `/team-tasks` denied without edit permission
- [ ] Direct URL to `/access-management` denied without employees edit
- [ ] Direct URL to `/ceo-command` denied without employees edit

---

## CRUD Testing

### Clients (`/clients` or CRM path)

- [ ] List loads without console errors
- [ ] Create client
- [ ] Edit client
- [ ] Delete client
- [ ] Data persists after refresh

### Employees (access management)

- [ ] Create employee record
- [ ] Edit department/role
- [ ] Deactivate employee (`is_active = false`)
- [ ] Permissions matrix saves correctly

### Tasks

- [ ] Create (CEO / scheduler)
- [ ] Read (CEO all, employee own)
- [ ] Update status (employee own)
- [ ] Update full record (CEO edit)
- [ ] Delete (CEO with delete permission)

### Permissions

- [ ] `get_my_rbac_access` RPC returns expected modules
- [ ] UI matches DB permissions after save + re-login

---

## Permissions & Security

- [ ] Protected routes redirect unauthenticated users to `/login`
- [ ] Unauthorized users see `/access-denied` (not blank page)
- [ ] Retry on RBAC load failure works (`AccessDenied` retry button)
- [ ] No service role / secret keys in frontend bundle
- [ ] RLS: employee cannot read another employee's tasks via API
- [ ] RLS: employee cannot update tasks not assigned to their email

---

## UI / UX Smoke

- [ ] Header navigation usable on desktop and mobile
- [ ] Tables scroll on small screens without breaking layout
- [ ] Loading states on heavy pages (tasks, access management, clients)
- [ ] Error boundary shows fallback instead of white screen on component crash

---

## Build & Deploy

- [ ] `npm run build` succeeds locally
- [ ] Vercel deploy green
- [ ] SPA deep links work (refresh on `/team-tasks`, `/my-tasks`, etc.)
- [ ] Hard refresh (`Ctrl+Shift+R`) after deploy

---

## Sign-off

| Role        | Name | Date | Pass/Fail |
|-------------|------|------|-----------|
| CEO tester  |      |      |           |
| Employee    |      |      |           |
| Engineering |      |      |           |

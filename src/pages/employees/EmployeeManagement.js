import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, CardContent, Checkbox, Chip, Collapse,
  Divider, FormControl, FormControlLabel, Grid, IconButton, InputAdornment,
  InputLabel, MenuItem, Paper, Select, Snackbar, Stack, Switch, Tab, Tabs,
  TextField, Typography, alpha,
} from '@mui/material';
import {
  Search as SearchIcon, PersonAdd, Visibility, VerifiedUser, Block,
  ContentCopy, Save as SaveIcon, FlashOn, ExpandMore, ExpandLess,
  Dashboard, ShoppingCart, Groups, Factory, Inventory2, LocalShipping,
  AccountBalance, Badge, AssignmentTurnedIn, Assessment, Settings, ViewModule,
  AccountBalanceWallet, School, FolderOpen, SupervisorAccount, ToggleOn,
} from '@mui/icons-material';
import { usePermissions } from '../../context/PermissionContext';
import LoadingScreen from '../../components/common/LoadingScreen';
import AccessDenied from '../../components/auth/AccessDenied';
import { DEPARTMENT_OPTIONS } from '../../config/departments';
import { supabase } from '../../lib/supabaseClient';
import {
  listAllEmployeePermissions, listEmployeePermissionOverrides, listEmployees,
  listModules, listRoles, revokeEmployeeAccess, saveEmployee,
  saveEmployeeModuleAccess, setEmployeeActive,
} from '../../services/rbacService';

// ---- Access matrix config (lifted from AccessManagementPage) --------------
const ROLE_PRESETS = {
  Sales: ['dashboard', 'sales', 'crm', 'tasks'],
  CRM: ['dashboard', 'crm', 'sales', 'tasks'],
  Production: ['dashboard', 'production', 'inventory', 'dispatch', 'tasks'],
  Inventory: ['dashboard', 'inventory', 'dispatch', 'tasks'],
  Accounts: ['dashboard', 'accounts', 'reports', 'tasks'],
  Dispatch: ['dashboard', 'dispatch', 'inventory', 'tasks'],
  HR: ['dashboard', 'employees', 'tasks', 'reports'],
  Manager: ['dashboard', 'crm', 'sales', 'production', 'inventory', 'dispatch', 'tasks', 'reports'],
};
const ACTIONS = ['can_view', 'can_create', 'can_edit', 'can_delete'];
const ACTION_LABEL = { can_view: 'View', can_create: 'Create', can_edit: 'Edit', can_delete: 'Delete' };

const MODULE_META = {
  dashboard: { icon: Dashboard, color: 'primary' },
  crm: { icon: Groups, color: 'info' },
  sales: { icon: ShoppingCart, color: 'success' },
  production: { icon: Factory, color: 'secondary' },
  inventory: { icon: Inventory2, color: 'warning' },
  dispatch: { icon: LocalShipping, color: 'info' },
  accounts: { icon: AccountBalance, color: 'success' },
  employees: { icon: Badge, color: 'secondary' },
  tasks: { icon: AssignmentTurnedIn, color: 'primary' },
  reports: { icon: Assessment, color: 'info' },
  settings: { icon: Settings, color: 'secondary' },
};
const moduleMeta = (key) => MODULE_META[key] || { icon: ViewModule, color: 'primary' };

const EMPLOYEE_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Consultant', 'Freelancer'];

const roleLabel = (role) => role?.role_name || role?.name || role?.code || 'Unassigned';
const initials = (name, email) => (name || email || '?').trim().slice(0, 1).toUpperCase();

function buildModuleDraft(modules, overrides) {
  const overrideMap = new Map((overrides || []).map((row) => [row.module_id, row]));
  return modules.map((module) => {
    const existing = overrideMap.get(module.id);
    return {
      module_id: module.id,
      module_key: module.module_key,
      module_name: module.module_name,
      can_view: Boolean(existing?.can_view),
      can_create: Boolean(existing?.can_create),
      can_edit: Boolean(existing?.can_edit),
      can_delete: Boolean(existing?.can_delete),
    };
  });
}

// Blank profile (PascalCase mirrors the employees_data view columns).
const emptyProfile = {
  EmployeeName: '', Email: '', Phone: '', Department: '', Designation: '',
  EmployeeType: 'Full-time', JoiningDate: '', DateOfBirth: '', Address: '',
  ReportingManager: '', SalaryGrade: '', Status: 'Active',
  HighestQualification: '', University: '', GraduationYear: '', Specialization: '',
  Experience: '', Skills: '', Certifications: '',
  UpiId: '', BankName: '', AccountNumber: '', IfscCode: '', BankBranch: '',
  AccountHolderName: '',
};

// Map a public.employees RBAC row (snake_case + HR cols) → the profile form.
const profileFromEmployee = (emp) => {
  if (!emp) return { ...emptyProfile };
  return {
    ...emptyProfile,
    EmployeeName: emp.full_name || '',
    Email: emp.email || '',
    Phone: emp.phone || '',
    Department: emp.department || '',
    Designation: emp.designation || '',
    EmployeeType: emp.employment_type || 'Full-time',
    JoiningDate: emp.joining_date || '',
    DateOfBirth: emp.date_of_birth || '',
    Address: emp.address || '',
    ReportingManager: emp.reporting_manager || '',
    SalaryGrade: emp.salary_grade || '',
    Status: emp.status || (emp.is_active === false ? 'Inactive' : 'Active'),
  };
};

// Inputs share a small style; declared once.
const fieldSx = {};

function EmployeeManagement() {
  const {
    canCreate, canEdit, canDelete, refreshAccess,
    loading: permissionsLoading, employee, authorized,
  } = usePermissions();

  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [modules, setModules] = useState([]);
  const [allEmployeePermissions, setAllEmployeePermissions] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  const [moduleDraft, setModuleDraft] = useState([]);
  const [profile, setProfile] = useState({ ...emptyProfile });
  // Identity fields that live on the RBAC master (role_id, is_active).
  const [roleId, setRoleId] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [showBank, setShowBank] = useState(false);
  const [showEducation, setShowEducation] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const canManageEmployees = canCreate('employees') || canEdit('employees') || canDelete('employees');
  const canAssignPermissions = canEdit('employees');

  const selectedEmployee = useMemo(
    () => employees.find((row) => row.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId],
  );

  const loadData = async () => {
    setError(null);
    try {
      const [employeeRows, roleRows, moduleRows, permissionRows] = await Promise.all([
        listEmployees(), listRoles(), listModules(), listAllEmployeePermissions(),
      ]);
      setEmployees(employeeRows);
      setRoles(roleRows);
      setModules(moduleRows);
      setAllEmployeePermissions(permissionRows);
      return { employeeRows, moduleRows };
    } catch (err) {
      setError(err.message || 'Failed to load employee data.');
      return { employeeRows: [], moduleRows: [] };
    }
  };

  useEffect(() => {
    if (!canManageEmployees) { setLoading(false); return; }
    let active = true;
    (async () => {
      setLoading(true);
      await loadData();
      if (active) setLoading(false);
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageEmployees]);

  // When the selected employee changes, hydrate the right pane.
  useEffect(() => {
    if (isCreating) return;
    if (!selectedEmployeeId) {
      setProfile({ ...emptyProfile });
      setRoleId('');
      setIsActive(true);
      setModuleDraft([]);
      return;
    }
    const emp = employees.find((row) => row.id === selectedEmployeeId);
    if (emp) {
      setProfile(profileFromEmployee(emp));
      setRoleId(emp.role_id || '');
      setIsActive(emp.is_active !== false);
    }
    let cancelled = false;
    (async () => {
      try {
        const overrides = await listEmployeePermissionOverrides(selectedEmployeeId);
        if (!cancelled) setModuleDraft(buildModuleDraft(modules, overrides));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load permissions.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId, employees, modules, isCreating]);

  // Module-count chip per employee (counts can_view overrides).
  const permissionByEmployee = useMemo(() => {
    const map = new Map();
    allEmployeePermissions.forEach((p) => {
      if (!map.has(p.employee_id)) map.set(p.employee_id, []);
      map.get(p.employee_id).push(p);
    });
    return map;
  }, [allEmployeePermissions]);

  const moduleCountFor = (empId) =>
    (permissionByEmployee.get(empId) || []).filter((p) => p.can_view).length;

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      [e.full_name, e.email, e.department, roleLabel(e.roles)]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [employees, search]);

  const visibleModules = useMemo(() => moduleDraft.filter((m) => m.can_view), [moduleDraft]);

  // ---- Actions ------------------------------------------------------------
  const handleSelectEmployee = (id) => {
    setIsCreating(false);
    setSelectedEmployeeId(id);
    setTab(0);
    setError(null); setSuccess(null);
  };

  const startNewEmployee = () => {
    setIsCreating(true);
    setSelectedEmployeeId(null);
    setProfile({ ...emptyProfile });
    setRoleId('');
    setIsActive(true);
    setModuleDraft(buildModuleDraft(modules, []));
    setTab(0);
    setError(null); setSuccess(null);
  };

  const handleProfileChange = (field, value) =>
    setProfile((prev) => ({ ...prev, [field]: value }));

  // Save profile → writes the master through the writable employees_data view,
  // and keeps the RBAC identity columns (full_name/phone/department/role) in sync.
  const handleSaveProfile = async () => {
    const email = String(profile.Email || '').trim().toLowerCase();
    if (!email) { setError('Email is required — it is how they log in.'); return; }
    if (!profile.EmployeeName?.trim()) { setError('Full name is required.'); return; }

    setSaving(true); setError(null); setSuccess(null);
    try {
      const nowIso = new Date().toISOString();
      const viewPayload = {
        EmployeeName: profile.EmployeeName || null,
        Email: email,
        Phone: profile.Phone || null,
        Department: profile.Department || null,
        Designation: profile.Designation || null,
        EmployeeType: profile.EmployeeType || null,
        JoiningDate: profile.JoiningDate || null,
        DateOfBirth: profile.DateOfBirth || null,
        Address: profile.Address || null,
        ReportingManager: profile.ReportingManager || null,
        SalaryGrade: profile.SalaryGrade || null,
        Status: profile.Status || (isActive ? 'Active' : 'Inactive'),
        HighestQualification: profile.HighestQualification || null,
        University: profile.University || null,
        GraduationYear: profile.GraduationYear || null,
        Specialization: profile.Specialization || null,
        Experience: profile.Experience || null,
        Skills: profile.Skills || null,
        Certifications: profile.Certifications || null,
        UpiId: profile.UpiId || null,
        BankName: profile.BankName || null,
        AccountNumber: profile.AccountNumber || null,
        IfscCode: profile.IfscCode || null,
        BankBranch: profile.BankBranch || null,
        AccountHolderName: profile.AccountHolderName || null,
        UpdatedAt: nowIso,
      };

      let savedId = selectedEmployeeId;
      if (selectedEmployeeId && !isCreating) {
        // Existing → update via the writable view.
        const { error: viewErr } = await supabase
          .from('employees_data').update(viewPayload).eq('Email', email);
        if (viewErr) throw viewErr;
        // Keep RBAC identity columns aligned.
        await saveEmployee({
          id: selectedEmployeeId, email,
          full_name: profile.EmployeeName, phone: profile.Phone,
          department: profile.Department, role_id: roleId || null, is_active: isActive,
        });
      } else {
        // New → ensure the RBAC master row exists first (drives login/RLS), then
        // enrich the HR columns through the view.
        const code = `EMP${String(Date.now()).slice(-6)}`;
        const saved = await saveEmployee({
          email, full_name: profile.EmployeeName, phone: profile.Phone,
          department: profile.Department, role_id: roleId || null, is_active: isActive,
        });
        savedId = saved.id;
        const { error: viewErr } = await supabase
          .from('employees_data')
          .update({ ...viewPayload, EmployeeCode: code })
          .eq('Email', email);
        if (viewErr) throw viewErr;
      }

      await loadData();
      setIsCreating(false);
      setSelectedEmployeeId(savedId);
      setSuccess('Profile saved.');
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Access matrix logic (lifted) --------------------------------------
  const handleDraftChange = (moduleId, field, checked) => {
    setModuleDraft((prev) => prev.map((row) => {
      if (row.module_id !== moduleId) return row;
      const next = { ...row, [field]: checked };
      if (field === 'can_view' && !checked) { next.can_create = next.can_edit = next.can_delete = false; }
      if (field !== 'can_view' && checked) { next.can_view = true; }
      return next;
    }));
  };

  const applyPreset = (presetKey) => {
    const keys = ROLE_PRESETS[presetKey] || [];
    setModuleDraft((prev) => prev.map((row) => {
      const on = keys.includes(row.module_key);
      return {
        ...row,
        can_view: on,
        can_create: on && row.module_key !== 'dashboard',
        can_edit: on && row.module_key !== 'dashboard',
        can_delete: false,
      };
    }));
    setSuccess(`Applied "${presetKey}" preset — review and Save access to apply.`);
  };

  const handleFullAccess = () => {
    setModuleDraft((prev) => prev.map((row) => ({ ...row, can_view: true, can_create: true, can_edit: true, can_delete: true })));
    setSuccess('Full access selected — Save access to apply.');
  };
  const handleClearAll = () => {
    setModuleDraft((prev) => prev.map((row) => ({ ...row, can_view: false, can_create: false, can_edit: false, can_delete: false })));
  };

  const copyFrom = async (sourceId) => {
    if (!sourceId) return;
    try {
      const overrides = await listEmployeePermissionOverrides(sourceId);
      setModuleDraft(buildModuleDraft(modules, overrides));
      const src = employees.find((e) => e.id === sourceId);
      setSuccess(`Copied access from ${src?.full_name || src?.email} — Save access to apply.`);
    } catch (err) { setError(err.message || 'Failed to copy access.'); }
  };

  const handleSaveAccess = async () => {
    if (!selectedEmployeeId) { setError('Save the profile first, then assign access.'); return; }
    setSaving(true); setError(null); setSuccess(null);
    try {
      await saveEmployeeModuleAccess(selectedEmployeeId, moduleDraft);
      const overrides = await listEmployeePermissionOverrides(selectedEmployeeId);
      setModuleDraft(buildModuleDraft(modules, overrides));
      await loadData();
      setSuccess('Access saved.');
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to save access.');
    } finally {
      setSaving(false);
    }
  };

  // Status / Active toggle — writes RBAC master, updates UI.
  const handleToggleActive = async (next) => {
    if (!selectedEmployeeId) { setIsActive(next); return; }
    setSaving(true); setError(null);
    try {
      await setEmployeeActive(selectedEmployeeId, next);
      setIsActive(next);
      setProfile((p) => ({ ...p, Status: next ? 'Active' : 'Inactive' }));
      await loadData();
      setSuccess(next ? 'Employee re-activated.' : 'Employee deactivated — ERP access removed.');
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to update status.');
    } finally {
      setSaving(false);
    }
  };

  // Reporting manager — saved through the view as text.
  const handleSaveReportingManager = async (value) => {
    handleProfileChange('ReportingManager', value);
    const email = String(profile.Email || '').trim().toLowerCase();
    if (!email || isCreating || !selectedEmployeeId) return;
    try {
      const { error: viewErr } = await supabase
        .from('employees_data')
        .update({ ReportingManager: value || null, UpdatedAt: new Date().toISOString() })
        .eq('Email', email);
      if (viewErr) throw viewErr;
      setSuccess('Reporting manager updated.');
    } catch (err) {
      setError(err.message || 'Failed to update reporting manager.');
    }
  };

  // ---- Gates --------------------------------------------------------------
  if (permissionsLoading) return <LoadingScreen message="Loading employee management…" />;
  if (!authorized || !employee) return <AccessDenied />;
  if (!canManageEmployees) return <Alert severity="error">Access Denied. This area is for the CEO / HR only.</Alert>;
  if (loading) return <LoadingScreen message="Loading employees…" />;

  const showRightPane = isCreating || Boolean(selectedEmployee);
  const headerName = profile.EmployeeName || selectedEmployee?.full_name || (isCreating ? 'New employee' : '');

  return (
    <Box sx={{ maxWidth: 1500, mx: 'auto', pb: 6 }}>
      <Stack spacing={2.5}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Groups color="action" />
            <Typography variant="h4" sx={{ fontWeight: 800 }}>Employee Management</Typography>
            <Chip size="small" color="primary" variant="outlined" label="CEO / HR" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            One place for every team member — profile, access, status and documents.
          </Typography>
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        <Grid container spacing={2.5} alignItems="flex-start">
          {/* ---------------- LEFT: employee list ---------------- */}
          <Grid item xs={12} md={4} lg={3.5} sx={{ width: { md: 360 } }}>
            <Card variant="outlined" sx={{ borderRadius: 3, position: { md: 'sticky' }, top: { md: 16 } }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
                  <Typography variant="h6" fontWeight={700}>Team</Typography>
                  <Button size="small" variant="contained" startIcon={<PersonAdd />} onClick={startNewEmployee}>
                    Add employee
                  </Button>
                </Stack>
                <TextField
                  size="small" fullWidth placeholder="Search name, email, department…" value={search}
                  onChange={(e) => setSearch(e.target.value)} sx={{ mb: 1.5 }}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                />
                <Box sx={{ maxHeight: { md: 'calc(100vh - 280px)' }, overflow: 'auto', mx: -1 }}>
                  <Stack spacing={0.75} sx={{ px: 1 }}>
                    {filteredEmployees.length === 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        No team members match.
                      </Typography>
                    )}
                    {filteredEmployees.map((emp) => {
                      const count = moduleCountFor(emp.id);
                      const selected = emp.id === selectedEmployeeId && !isCreating;
                      const inactive = emp.is_active === false;
                      return (
                        <Paper
                          key={emp.id} variant="outlined" onClick={() => handleSelectEmployee(emp.id)}
                          sx={{
                            p: 1.25, borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1.5,
                            borderColor: selected ? 'primary.main' : 'divider',
                            bgcolor: (t) => (selected ? alpha(t.palette.primary.main, 0.08) : 'background.paper'),
                            transition: 'border-color .15s, background-color .15s',
                            '&:hover': { borderColor: 'primary.light' },
                          }}
                        >
                          <Box sx={{ position: 'relative' }}>
                            <Avatar sx={{ width: 40, height: 40, fontWeight: 700, bgcolor: inactive ? 'grey.400' : 'primary.main' }}>
                              {initials(emp.full_name, emp.email)}
                            </Avatar>
                            <Box sx={{
                              position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: '50%',
                              border: '2px solid', borderColor: 'background.paper',
                              bgcolor: inactive ? 'grey.400' : 'success.main',
                            }} />
                          </Box>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" fontWeight={700} noWrap>{emp.full_name || emp.email}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap display="block">
                              {[roleLabel(emp.roles), emp.department].filter(Boolean).join(' · ') || 'No role yet'}
                            </Typography>
                          </Box>
                          <Stack alignItems="flex-end" spacing={0.5}>
                            <Chip size="small" color={count > 0 ? 'info' : 'default'} variant={count > 0 ? 'filled' : 'outlined'}
                              label={`${count} modules`} sx={{ height: 22, fontWeight: 600 }} />
                            {inactive && <Chip size="small" color="warning" variant="outlined" label="inactive" sx={{ height: 18, fontSize: 10 }} />}
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* ---------------- RIGHT: detail pane ---------------- */}
          <Grid item xs={12} md={8} lg={8.5} sx={{ flexGrow: 1 }}>
            {!showRightPane ? (
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent sx={{ py: 12, textAlign: 'center' }}>
                  <Avatar sx={{ width: 64, height: 64, mx: 'auto', mb: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}>
                    <Badge />
                  </Avatar>
                  <Typography variant="h6" fontWeight={700}>Nobody selected</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Select an employee to view their profile, access and status.
                  </Typography>
                </CardContent>
              </Card>
            ) : (
              <Stack spacing={2.5}>
                {/* Identity header */}
                <Card variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
                  <Box sx={{ height: 64, bgcolor: (t) => alpha(t.palette.primary.main, 0.10) }} />
                  <CardContent sx={{ pt: 0 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} sx={{ mt: -4 }}>
                      <Avatar sx={{ width: 72, height: 72, fontSize: 28, fontWeight: 700, border: '3px solid', borderColor: 'background.paper', bgcolor: isActive ? 'primary.main' : 'grey.400' }}>
                        {initials(profile.EmployeeName, profile.Email)}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0, pb: 0.5 }}>
                        <Typography variant="h6" fontWeight={800} noWrap>{headerName || 'New employee'}</Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {profile.Email || 'Add an email so they can log in'}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={2} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 150 }}>
                          <InputLabel>Role</InputLabel>
                          <Select label="Role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                            <MenuItem value=""><em>Unassigned</em></MenuItem>
                            {roles.map((role) => <MenuItem key={role.id} value={role.id}>{roleLabel(role)}</MenuItem>)}
                          </Select>
                        </FormControl>
                        <FormControlLabel
                          sx={{ m: 0 }}
                          control={(
                            <Switch
                              checked={isActive}
                              disabled={saving}
                              onChange={(e) => handleToggleActive(e.target.checked)}
                            />
                          )}
                          label={<Typography variant="caption" color="text.secondary">{isActive ? 'Active' : 'Inactive'}</Typography>}
                          labelPlacement="start"
                        />
                      </Stack>
                    </Stack>

                    <Tabs
                      value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
                      sx={{ mt: 2, borderTop: '1px solid', borderColor: 'divider' }}
                    >
                      <Tab icon={<Badge fontSize="small" />} iconPosition="start" label="Profile" />
                      <Tab icon={<VerifiedUser fontSize="small" />} iconPosition="start" label="Access & Permissions" />
                      <Tab icon={<ToggleOn fontSize="small" />} iconPosition="start" label="Status" />
                      <Tab icon={<FolderOpen fontSize="small" />} iconPosition="start" label="Documents" />
                      <Tab icon={<SupervisorAccount fontSize="small" />} iconPosition="start" label="Reporting Manager" />
                    </Tabs>
                  </CardContent>
                </Card>

                {/* ---- TAB 0: Profile ---- */}
                {tab === 0 && (
                  <Card variant="outlined" sx={{ borderRadius: 3 }}>
                    <CardContent>
                      <Typography variant="h6" fontWeight={700} mb={2}>Profile</Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                          <TextField label="Full name *" value={profile.EmployeeName} onChange={(e) => handleProfileChange('EmployeeName', e.target.value)} fullWidth size="small" sx={fieldSx} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField label="Email *" value={profile.Email} onChange={(e) => handleProfileChange('Email', e.target.value)} fullWidth size="small" helperText="The Google email they log in with" />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField label="Phone" value={profile.Phone} onChange={(e) => handleProfileChange('Phone', e.target.value)} fullWidth size="small" />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <FormControl fullWidth size="small">
                            <InputLabel>Department</InputLabel>
                            <Select label="Department" value={profile.Department} onChange={(e) => handleProfileChange('Department', e.target.value)}>
                              {DEPARTMENT_OPTIONS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField label="Designation" value={profile.Designation} onChange={(e) => handleProfileChange('Designation', e.target.value)} fullWidth size="small" />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <FormControl fullWidth size="small">
                            <InputLabel>Employment type</InputLabel>
                            <Select label="Employment type" value={profile.EmployeeType} onChange={(e) => handleProfileChange('EmployeeType', e.target.value)}>
                              {EMPLOYEE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField label="Joining date" type="date" value={profile.JoiningDate || ''} onChange={(e) => handleProfileChange('JoiningDate', e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField label="Date of birth" type="date" value={profile.DateOfBirth || ''} onChange={(e) => handleProfileChange('DateOfBirth', e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField label="Address" value={profile.Address} onChange={(e) => handleProfileChange('Address', e.target.value)} fullWidth size="small" multiline rows={2} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField label="Reporting manager" value={profile.ReportingManager} onChange={(e) => handleProfileChange('ReportingManager', e.target.value)} fullWidth size="small" />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField label="Salary grade" value={profile.SalaryGrade} onChange={(e) => handleProfileChange('SalaryGrade', e.target.value)} fullWidth size="small" />
                        </Grid>
                      </Grid>

                      {/* Collapsible: Education */}
                      <Divider sx={{ my: 2.5 }} />
                      <Stack direction="row" alignItems="center" justifyContent="space-between"
                        sx={{ cursor: 'pointer' }} onClick={() => setShowEducation((v) => !v)}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <School fontSize="small" color="action" />
                          <Typography variant="subtitle1" fontWeight={700}>Education & skills</Typography>
                        </Stack>
                        <IconButton size="small">{showEducation ? <ExpandLess /> : <ExpandMore />}</IconButton>
                      </Stack>
                      <Collapse in={showEducation} unmountOnExit>
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                          <Grid item xs={12} sm={6}><TextField label="Highest qualification" value={profile.HighestQualification} onChange={(e) => handleProfileChange('HighestQualification', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="University / Institute" value={profile.University} onChange={(e) => handleProfileChange('University', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="Graduation year" value={profile.GraduationYear} onChange={(e) => handleProfileChange('GraduationYear', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="Specialization" value={profile.Specialization} onChange={(e) => handleProfileChange('Specialization', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="Experience" value={profile.Experience} onChange={(e) => handleProfileChange('Experience', e.target.value)} fullWidth size="small" placeholder="e.g. 3 Years" /></Grid>
                          <Grid item xs={12}><TextField label="Skills" value={profile.Skills} onChange={(e) => handleProfileChange('Skills', e.target.value)} fullWidth size="small" multiline rows={2} /></Grid>
                          <Grid item xs={12}><TextField label="Certifications" value={profile.Certifications} onChange={(e) => handleProfileChange('Certifications', e.target.value)} fullWidth size="small" multiline rows={2} /></Grid>
                        </Grid>
                      </Collapse>

                      {/* Collapsible: Bank */}
                      <Divider sx={{ my: 2.5 }} />
                      <Stack direction="row" alignItems="center" justifyContent="space-between"
                        sx={{ cursor: 'pointer' }} onClick={() => setShowBank((v) => !v)}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <AccountBalanceWallet fontSize="small" color="action" />
                          <Typography variant="subtitle1" fontWeight={700}>Bank & payment</Typography>
                        </Stack>
                        <IconButton size="small">{showBank ? <ExpandLess /> : <ExpandMore />}</IconButton>
                      </Stack>
                      <Collapse in={showBank} unmountOnExit>
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                          <Grid item xs={12} sm={6}><TextField label="Account holder name" value={profile.AccountHolderName} onChange={(e) => handleProfileChange('AccountHolderName', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="Bank name" value={profile.BankName} onChange={(e) => handleProfileChange('BankName', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="Account number" value={profile.AccountNumber} onChange={(e) => handleProfileChange('AccountNumber', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="IFSC code" value={profile.IfscCode} onChange={(e) => handleProfileChange('IfscCode', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="Bank branch" value={profile.BankBranch} onChange={(e) => handleProfileChange('BankBranch', e.target.value)} fullWidth size="small" /></Grid>
                          <Grid item xs={12} sm={6}><TextField label="UPI ID" value={profile.UpiId} onChange={(e) => handleProfileChange('UpiId', e.target.value)} fullWidth size="small" /></Grid>
                        </Grid>
                      </Collapse>

                      <Stack direction="row" justifyContent="flex-end" mt={3}>
                        <Button variant="contained" startIcon={<SaveIcon />} onClick={() => void handleSaveProfile()} disabled={saving || !profile.Email}>
                          {saving ? 'Saving…' : (isCreating ? 'Create employee' : 'Save profile')}
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                {/* ---- TAB 1: Access & Permissions ---- */}
                {tab === 1 && (
                  <Stack spacing={2.5}>
                    {isCreating && (
                      <Alert severity="info">Save the profile first (Profile tab) — then assign module access here.</Alert>
                    )}
                    {/* Quick setup */}
                    <Card variant="outlined" sx={{ borderRadius: 3, borderColor: 'primary.light' }}>
                      <CardContent>
                        <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                          <FlashOn fontSize="small" color="primary" />
                          <Typography variant="h6" fontWeight={700}>Quick setup</Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">Apply a role preset in one click, then fine-tune below.</Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                          {Object.keys(ROLE_PRESETS).map((k) => (
                            <Button key={k} size="small" variant="outlined" onClick={() => applyPreset(k)} disabled={!canAssignPermissions}>{`Apply ${k}`}</Button>
                          ))}
                        </Stack>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }} alignItems="center">
                          <Button size="small" variant="contained" color="success" startIcon={<VerifiedUser />} onClick={handleFullAccess} disabled={!canAssignPermissions}>Full access</Button>
                          <Button size="small" variant="outlined" color="warning" startIcon={<Block />} onClick={handleClearAll} disabled={!canAssignPermissions}>Clear all</Button>
                          <FormControl size="small" sx={{ minWidth: 200 }}>
                            <InputLabel>Copy from…</InputLabel>
                            <Select label="Copy from…" value="" onChange={(e) => copyFrom(e.target.value)} disabled={!canAssignPermissions}
                              renderValue={() => 'Copy from…'}>
                              {employees.filter((e) => e.id !== selectedEmployeeId).map((e) => (
                                <MenuItem key={e.id} value={e.id}><ContentCopy fontSize="small" sx={{ mr: 1 }} />{e.full_name || e.email}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Stack>
                      </CardContent>
                    </Card>

                    {/* Module access matrix */}
                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
                          <Typography variant="h6" fontWeight={700}>Module access</Typography>
                          <Chip size="small" variant="outlined" color="info" label={`${visibleModules.length} of ${moduleDraft.length} on`} />
                        </Stack>
                        <Stack spacing={1}>
                          {moduleDraft.length === 0 && (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No modules configured.</Typography>
                          )}
                          {moduleDraft.map((row) => {
                            const meta = moduleMeta(row.module_key);
                            const Icon = meta.icon;
                            const on = Boolean(row.can_view);
                            return (
                              <Paper
                                key={row.module_id} variant="outlined"
                                sx={{
                                  p: 1.5, borderRadius: 2,
                                  borderColor: on ? `${meta.color}.light` : 'divider',
                                  bgcolor: (t) => (on ? alpha(t.palette[meta.color].main, 0.06) : 'background.paper'),
                                  transition: 'border-color .15s, background-color .15s',
                                }}
                              >
                                <Stack direction="row" alignItems="center" spacing={1.5}>
                                  <Avatar variant="rounded" sx={{
                                    width: 38, height: 38,
                                    bgcolor: (t) => alpha(t.palette[meta.color].main, on ? 0.16 : 0.08),
                                    color: on ? `${meta.color}.dark` : 'text.disabled',
                                  }}>
                                    <Icon fontSize="small" />
                                  </Avatar>
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="body2" fontWeight={on ? 700 : 500} noWrap>{row.module_name}</Typography>
                                    <Typography variant="caption" color="text.secondary">{on ? 'Visible after login' : 'Hidden'}</Typography>
                                  </Box>
                                  <Stack direction="row" alignItems="center" spacing={0.5}>
                                    <Typography variant="caption" color={on ? `${meta.color}.dark` : 'text.disabled'} fontWeight={600}>Access</Typography>
                                    <Switch
                                      color={meta.color}
                                      checked={on}
                                      disabled={!canAssignPermissions}
                                      onChange={(e) => handleDraftChange(row.module_id, 'can_view', e.target.checked)}
                                    />
                                  </Stack>
                                </Stack>
                                <Collapse in={on} unmountOnExit>
                                  <Box sx={{ pl: { sm: 7 }, pt: 1.25 }}>
                                    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
                                      <Typography variant="caption" color="text.secondary">Can also:</Typography>
                                      {ACTIONS.filter((a) => a !== 'can_view').map((a) => (
                                        <FormControlLabel
                                          key={a}
                                          sx={{ m: 0 }}
                                          control={(
                                            <Checkbox
                                              size="small"
                                              color={meta.color}
                                              checked={Boolean(row[a])}
                                              disabled={!canAssignPermissions || !on}
                                              onChange={(e) => handleDraftChange(row.module_id, a, e.target.checked)}
                                            />
                                          )}
                                          label={<Typography variant="body2">{ACTION_LABEL[a]}</Typography>}
                                        />
                                      ))}
                                    </Stack>
                                  </Box>
                                </Collapse>
                              </Paper>
                            );
                          })}
                        </Stack>
                      </CardContent>
                    </Card>

                    {/* What they'll see */}
                    <Card variant="outlined" sx={{ borderRadius: 3, borderColor: 'info.light', bgcolor: (t) => alpha(t.palette.info.main, 0.05) }}>
                      <CardContent>
                        <Stack direction="row" alignItems="center" spacing={1} mb={1.25}>
                          <Visibility fontSize="small" color="info" />
                          <Typography variant="subtitle1" fontWeight={700}>What {profile.EmployeeName || 'this person'} will see after login</Typography>
                        </Stack>
                        {visibleModules.length === 0 ? (
                          <Alert severity="warning" sx={{ py: 0.5 }}>No modules selected — they will log in to an empty ERP.</Alert>
                        ) : (
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            {visibleModules.map((m) => {
                              const Icon = moduleMeta(m.module_key).icon;
                              return (
                                <Chip key={m.module_id} color="info" variant="outlined" label={m.module_name}
                                  icon={<Icon sx={{ fontSize: 16 }} />} sx={{ fontWeight: 600, bgcolor: 'background.paper' }} />
                              );
                            })}
                          </Stack>
                        )}
                      </CardContent>
                    </Card>

                    {/* Save bar */}
                    <Paper variant="outlined" sx={{ borderRadius: 3, p: 2, position: 'sticky', bottom: 12, bgcolor: 'background.paper', boxShadow: 3 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                        <Typography variant="body2" color="text.secondary">
                          {visibleModules.length} module{visibleModules.length === 1 ? '' : 's'} selected — changes apply when you save.
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          {selectedEmployee && (
                            <Button color="warning" variant="text" disabled={saving || !canAssignPermissions}
                              onClick={async () => {
                                if (!window.confirm(`Revoke ALL access for ${selectedEmployee.email}?`)) return;
                                setSaving(true);
                                try {
                                  await revokeEmployeeAccess(selectedEmployee.id);
                                  setModuleDraft(buildModuleDraft(modules, []));
                                  await loadData();
                                  setSuccess('Access revoked.');
                                  await refreshAccess();
                                } catch (err) { setError(err.message); } finally { setSaving(false); }
                              }}>Revoke all</Button>
                          )}
                          <Button variant="contained" size="large" startIcon={<SaveIcon />} disabled={saving || !canAssignPermissions || !selectedEmployeeId} onClick={() => void handleSaveAccess()}>
                            {saving ? 'Saving…' : 'Save access'}
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  </Stack>
                )}

                {/* ---- TAB 2: Status ---- */}
                {tab === 2 && (
                  <Card variant="outlined" sx={{ borderRadius: 3 }}>
                    <CardContent>
                      <Typography variant="h6" fontWeight={700} mb={2}>Status</Typography>
                      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: (t) => alpha(t.palette[isActive ? 'success' : 'warning'].main, 0.06), borderColor: isActive ? 'success.light' : 'warning.light' }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                          <Box>
                            <Typography variant="subtitle1" fontWeight={700}>{isActive ? 'Active' : 'Inactive'}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {isActive
                                ? 'This employee can log in and access their assigned modules.'
                                : 'This employee is blocked from logging in to the ERP.'}
                            </Typography>
                          </Box>
                          <Switch checked={isActive} disabled={saving || !selectedEmployeeId} onChange={(e) => handleToggleActive(e.target.checked)} />
                        </Stack>
                      </Paper>
                      <Alert severity="warning" sx={{ mt: 2 }}>
                        Marking an employee inactive immediately removes their ERP access. Their profile and history are kept.
                      </Alert>
                    </CardContent>
                  </Card>
                )}

                {/* ---- TAB 3: Documents ---- */}
                {tab === 3 && (
                  <Card variant="outlined" sx={{ borderRadius: 3 }}>
                    <CardContent sx={{ py: 8, textAlign: 'center' }}>
                      <Avatar sx={{ width: 56, height: 56, mx: 'auto', mb: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}>
                        <FolderOpen />
                      </Avatar>
                      <Typography variant="h6" fontWeight={700}>Documents</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', mt: 0.5 }}>
                        Coming soon — upload and manage contracts, ID proofs and certificates per employee.
                      </Typography>
                      <Chip size="small" variant="outlined" label="Coming soon" sx={{ mt: 2 }} />
                    </CardContent>
                  </Card>
                )}

                {/* ---- TAB 4: Reporting Manager ---- */}
                {tab === 4 && (
                  <Card variant="outlined" sx={{ borderRadius: 3 }}>
                    <CardContent>
                      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                        <SupervisorAccount color="action" />
                        <Typography variant="h6" fontWeight={700}>Reporting manager</Typography>
                      </Stack>
                      <Typography variant="body2" color="text.secondary" mb={2}>
                        Who does {profile.EmployeeName || 'this employee'} report to?
                      </Typography>
                      <FormControl fullWidth size="small" sx={{ maxWidth: 420 }}>
                        <InputLabel>Reporting manager</InputLabel>
                        <Select
                          label="Reporting manager"
                          value={profile.ReportingManager || ''}
                          onChange={(e) => handleSaveReportingManager(e.target.value)}
                          disabled={isCreating || !selectedEmployeeId}
                        >
                          <MenuItem value=""><em>None</em></MenuItem>
                          {employees
                            .filter((e) => e.id !== selectedEmployeeId)
                            .map((e) => (
                              <MenuItem key={e.id} value={e.full_name || e.email}>
                                {e.full_name || e.email}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      {isCreating && (
                        <Alert severity="info" sx={{ mt: 2 }}>Save the profile first to set a reporting manager.</Alert>
                      )}
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                        Saved on the employee record. Selecting a manager updates immediately.
                      </Typography>
                    </CardContent>
                  </Card>
                )}
              </Stack>
            )}
          </Grid>
        </Grid>
      </Stack>

      <Snackbar
        open={Boolean(success)} autoHideDuration={3500} onClose={() => setSuccess(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSuccess(null)}>{success}</Alert>
      </Snackbar>
    </Box>
  );
}

export default EmployeeManagement;

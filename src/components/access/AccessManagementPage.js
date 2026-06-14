import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, CardContent, Chip, FormControl,
  Grid, InputAdornment, InputLabel, MenuItem, Paper, Select, Stack,
  Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material';
import {
  Search as SearchIcon, PersonAdd, Visibility, VerifiedUser, Block,
  ContentCopy, CheckCircle, RadioButtonUnchecked, Lock,
} from '@mui/icons-material';
import { usePermissions } from '../../context/PermissionContext';
import LoadingScreen from '../common/LoadingScreen';
import AccessDenied from '../auth/AccessDenied';
import { DEPARTMENT_OPTIONS } from '../../config/departments';
import {
  listAllEmployeePermissions, listEmployeePermissionOverrides,
  listEmployees, listModules, listRoles, revokeEmployeeAccess, saveEmployee,
  saveEmployeeModuleAccess, setEmployeeActive,
} from '../../services/rbacService';

const emptyEmployee = { id: null, email: '', full_name: '', phone: '', department: '', role_id: '', is_active: true };

// Quick presets mirror the role defaults seeded in supabase_rbac_setup.sql so the
// CEO can grant a sensible module set in one click (access stays per-person).
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

function AccessManagementPage() {
  const { canCreate, canEdit, canDelete, refreshAccess, loading: permissionsLoading, employee, authorized } = usePermissions();

  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [modules, setModules] = useState([]);
  const [allEmployeePermissions, setAllEmployeePermissions] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [moduleDraft, setModuleDraft] = useState([]);
  const [form, setForm] = useState(emptyEmployee);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const selectedEmployee = useMemo(
    () => employees.find((row) => row.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId],
  );

  const canManageEmployees = canCreate('employees') || canEdit('employees') || canDelete('employees');
  const canAssignPermissions = canEdit('employees');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeeRows, roleRows, moduleRows, employeePermissionRows] = await Promise.all([
        listEmployees(), listRoles(), listModules(), listAllEmployeePermissions(),
      ]);
      setEmployees(employeeRows);
      setRoles(roleRows);
      setModules(moduleRows);
      setAllEmployeePermissions(employeePermissionRows);
      if (!selectedEmployeeId && employeeRows[0]) setSelectedEmployeeId(employeeRows[0].id);
    } catch (err) {
      setError(err.message || 'Failed to load access management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (canManageEmployees) void loadData(); }, [canManageEmployees]);

  useEffect(() => {
    if (!selectedEmployeeId) { setModuleDraft([]); return; }
    const emp = employees.find((row) => row.id === selectedEmployeeId);
    if (emp) {
      setForm({
        id: emp.id, email: emp.email || '', full_name: emp.full_name || '', phone: emp.phone || '',
        department: emp.department || '', role_id: emp.role_id || '', is_active: emp.is_active !== false,
      });
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
  }, [selectedEmployeeId, employees, modules]);

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
    return employees.filter((e) => {
      if (deptFilter !== 'all' && (e.department || '') !== deptFilter) return false;
      if (statusFilter === 'active' && e.is_active === false) return false;
      if (statusFilter === 'inactive' && e.is_active !== false) return false;
      if (statusFilter === 'noaccess' && moduleCountFor(e.id) > 0) return false;
      if (!q) return true;
      return [e.full_name, e.email, e.department, roleLabel(e.roles)]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [employees, search, deptFilter, statusFilter, permissionByEmployee]);

  const stats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter((e) => e.is_active !== false).length;
    const withAccess = employees.filter((e) => moduleCountFor(e.id) > 0).length;
    return { total, active, withAccess, noAccess: total - withAccess };
  }, [employees, permissionByEmployee]);

  // "What they'll see" — live preview from the current draft.
  const visibleModules = useMemo(() => moduleDraft.filter((m) => m.can_view), [moduleDraft]);

  const startNewEmployee = () => {
    setSelectedEmployeeId(null);
    setForm(emptyEmployee);
    setModuleDraft(buildModuleDraft(modules, []));
    setSuccess(null); setError(null);
  };

  const handleSaveEmployee = async () => {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const saved = await saveEmployee(form);
      await loadData();
      setSelectedEmployeeId(saved.id);
      setSuccess('Employee saved.');
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to save employee.');
    } finally { setSaving(false); }
  };

  const handleSaveAccess = async () => {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const saved = await saveEmployee(form);
      const empId = saved.id;
      await saveEmployeeModuleAccess(empId, moduleDraft);
      await loadData();
      setSelectedEmployeeId(empId);
      const overrides = await listEmployeePermissionOverrides(empId);
      setModuleDraft(buildModuleDraft(modules, overrides));
      setSuccess(`Access saved for ${saved.email}.`);
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to save access.');
    } finally { setSaving(false); }
  };

  const handleToggleActive = async (emp) => {
    try { await setEmployeeActive(emp.id, !emp.is_active); await loadData(); }
    catch (err) { setError(err.message || 'Failed to update employee status.'); }
  };

  // Smart toggle: enabling create/edit/delete implies view; clearing view clears all.
  const handleDraftChange = (moduleId, field, checked) => {
    setModuleDraft((prev) => prev.map((row) => {
      if (row.module_id !== moduleId) return row;
      const next = { ...row, [field]: checked };
      if (field === 'can_view' && !checked) { next.can_create = next.can_edit = next.can_delete = false; }
      if (field !== 'can_view' && checked) { next.can_view = true; }
      return next;
    }));
  };

  const toggleColumn = (field, checked) => {
    setModuleDraft((prev) => prev.map((row) => {
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
    setSuccess(`Applied "${presetKey}" preset — review and Save Access to apply.`);
  };

  const handleFullAccess = () => {
    setModuleDraft((prev) => prev.map((row) => ({ ...row, can_view: true, can_create: true, can_edit: true, can_delete: true })));
    setSuccess('Full access selected — Save Access to apply.');
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
      setSuccess(`Copied access from ${src?.full_name || src?.email} — Save Access to apply.`);
    } catch (err) { setError(err.message || 'Failed to copy access.'); }
  };

  if (permissionsLoading) return <LoadingScreen message="Loading access management…" />;
  if (!authorized || !employee) return <AccessDenied />;
  if (!canManageEmployees) return <Alert severity="error">Access Denied. This area is for the CEO only.</Alert>;
  if (loading) return <LoadingScreen message="Loading employees and permissions…" />;

  const StatCard = ({ label, value, color, icon }) => (
    <Paper variant="outlined" elevation={0} sx={{ p: 2, borderRadius: 2, flex: 1 }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar variant="rounded" sx={{ bgcolor: `${color}.light`, color: `${color}.dark`, width: 40, height: 40 }}>{icon}</Avatar>
        <Box>
          <Typography variant="h5" fontWeight={800} lineHeight={1}>{value}</Typography>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
        </Box>
      </Stack>
    </Paper>
  );

  return (
    <Box sx={{ maxWidth: 1500, mx: 'auto', pb: 6 }}>
      <Stack spacing={2.5}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Lock fontSize="small" color="action" />
            <Typography variant="h4" sx={{ fontWeight: 800 }}>Employee Access Management</Typography>
            <Chip size="small" color="primary" variant="outlined" label="CEO only" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Add employees, set their department &amp; role, and choose exactly which modules they see after they log in with their email.
          </Typography>
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <StatCard label="Employees" value={stats.total} color="primary" icon={<VerifiedUser fontSize="small" />} />
          <StatCard label="Active" value={stats.active} color="success" icon={<CheckCircle fontSize="small" />} />
          <StatCard label="With access" value={stats.withAccess} color="info" icon={<Visibility fontSize="small" />} />
          <StatCard label="No access yet" value={stats.noAccess} color="warning" icon={<Block fontSize="small" />} />
        </Stack>

        <Grid container spacing={2.5}>
          {/* LEFT: employee list */}
          <Grid item xs={12} md={5} lg={4}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
                  <Typography variant="h6" fontWeight={700}>Employees</Typography>
                  <Button size="small" variant="contained" startIcon={<PersonAdd />} onClick={startNewEmployee}>Add</Button>
                </Stack>
                <TextField
                  size="small" fullWidth placeholder="Search name, email, role…" value={search}
                  onChange={(e) => setSearch(e.target.value)} sx={{ mb: 1.5 }}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                />
                <Stack direction="row" spacing={1} mb={1.5}>
                  <FormControl size="small" sx={{ flex: 1 }}>
                    <InputLabel>Dept</InputLabel>
                    <Select label="Dept" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                      <MenuItem value="all">All</MenuItem>
                      {DEPARTMENT_OPTIONS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ flex: 1 }}>
                    <InputLabel>Status</InputLabel>
                    <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                      <MenuItem value="all">All</MenuItem>
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="inactive">Inactive</MenuItem>
                      <MenuItem value="noaccess">No access</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>
                <Box sx={{ maxHeight: 560, overflow: 'auto', mx: -1 }}>
                  <Stack spacing={0.5} sx={{ px: 1 }}>
                    {filteredEmployees.length === 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No employees match.</Typography>
                    )}
                    {filteredEmployees.map((emp) => {
                      const count = moduleCountFor(emp.id);
                      const selected = emp.id === selectedEmployeeId;
                      return (
                        <Paper
                          key={emp.id} variant="outlined" onClick={() => setSelectedEmployeeId(emp.id)}
                          sx={{
                            p: 1, borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1.5,
                            borderColor: selected ? 'primary.main' : 'divider',
                            bgcolor: selected ? 'primary.lighter' : 'background.paper',
                            '&:hover': { borderColor: 'primary.light' },
                          }}
                        >
                          <Avatar sx={{ width: 36, height: 36, bgcolor: emp.is_active !== false ? 'primary.main' : 'grey.400' }}>
                            {initials(emp.full_name, emp.email)}
                          </Avatar>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" fontWeight={700} noWrap>{emp.full_name || emp.email}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap display="block">{emp.email}</Typography>
                            <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap" useFlexGap>
                              {emp.department && <Chip size="small" label={emp.department} sx={{ height: 18, fontSize: 10 }} />}
                              <Chip size="small" variant="outlined" label={roleLabel(emp.roles)} sx={{ height: 18, fontSize: 10 }} />
                            </Stack>
                          </Box>
                          <Stack alignItems="flex-end" spacing={0.5}>
                            <Chip size="small" color={count > 0 ? 'info' : 'default'} label={`${count} mod`} sx={{ height: 20 }} />
                            {emp.is_active === false && <Chip size="small" color="warning" label="off" sx={{ height: 18, fontSize: 10 }} />}
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* RIGHT: editor */}
          <Grid item xs={12} md={7} lg={8}>
            <Stack spacing={2.5}>
              {/* Identity */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={700} gutterBottom>{form.id ? 'Edit Employee' : 'Add Employee'}</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}><TextField label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth size="small" helperText="The Google email they log in with" /></Grid>
                    <Grid item xs={12} sm={6}><TextField label="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} fullWidth size="small" /></Grid>
                    <Grid item xs={12} sm={6}><TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth size="small" /></Grid>
                    <Grid item xs={12} sm={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Department</InputLabel>
                        <Select label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                          {DEPARTMENT_OPTIONS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Role</InputLabel>
                        <Select label="Role" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
                          {roles.map((role) => <MenuItem key={role.id} value={role.id}>{roleLabel(role)}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Grid>
                  </Grid>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" mt={2}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2">Active</Typography>
                      <Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                      <Typography variant="caption" color="text.secondary">{form.is_active ? 'Can log in' : 'Login blocked'}</Typography>
                    </Stack>
                    <Button variant="outlined" onClick={() => void handleSaveEmployee()} disabled={saving || !form.email}>Save details</Button>
                  </Stack>
                </CardContent>
              </Card>

              {/* Preview — what they'll see */}
              <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'info.light', bgcolor: 'info.lighter' }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <Visibility fontSize="small" color="info" />
                    <Typography variant="subtitle1" fontWeight={700}>What {form.full_name || 'this employee'} will see after login</Typography>
                  </Stack>
                  {visibleModules.length === 0 ? (
                    <Alert severity="warning" sx={{ py: 0.5 }}>No modules selected — they will log in to an empty ERP. Apply a preset or tick modules below.</Alert>
                  ) : (
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {visibleModules.map((m) => (
                        <Chip key={m.module_id} color="info" label={m.module_name}
                          icon={<CheckCircle sx={{ fontSize: 16 }} />} sx={{ fontWeight: 600 }} />
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>

              {/* Matrix + presets */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={700} gutterBottom>Module access</Typography>
                  <Typography variant="caption" color="text.secondary">Quick presets (then fine-tune &amp; Save):</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 1.5 }}>
                    {Object.keys(ROLE_PRESETS).map((k) => (
                      <Button key={k} size="small" variant="outlined" onClick={() => applyPreset(k)} disabled={!canAssignPermissions}>{k}</Button>
                    ))}
                    <Button size="small" variant="outlined" color="success" startIcon={<VerifiedUser />} onClick={handleFullAccess} disabled={!canAssignPermissions}>Full access</Button>
                    <Button size="small" variant="outlined" color="warning" startIcon={<Block />} onClick={handleClearAll} disabled={!canAssignPermissions}>Clear all</Button>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                      <InputLabel>Copy access from…</InputLabel>
                      <Select label="Copy access from…" value="" onChange={(e) => copyFrom(e.target.value)} disabled={!canAssignPermissions}
                        renderValue={() => 'Copy access from…'}>
                        {employees.filter((e) => e.id !== selectedEmployeeId).map((e) => (
                          <MenuItem key={e.id} value={e.id}><ContentCopy fontSize="small" sx={{ mr: 1 }} />{e.full_name || e.email}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>

                  <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>Module</TableCell>
                          {ACTIONS.map((a) => (
                            <TableCell key={a} align="center" sx={{ fontWeight: 700 }}>
                              <Stack alignItems="center" spacing={0}>
                                <span>{ACTION_LABEL[a]}</span>
                                <Tooltip title={`Toggle ${ACTION_LABEL[a]} for all`}>
                                  <span>
                                    <Switch size="small" disabled={!canAssignPermissions}
                                      checked={moduleDraft.length > 0 && moduleDraft.every((r) => r[a])}
                                      onChange={(e) => toggleColumn(a, e.target.checked)} />
                                  </span>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {moduleDraft.map((row) => (
                          <TableRow key={row.module_id} hover sx={{ bgcolor: row.can_view ? 'action.hover' : 'inherit' }}>
                            <TableCell>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                {row.can_view ? <CheckCircle fontSize="small" color="success" /> : <RadioButtonUnchecked fontSize="small" color="disabled" />}
                                <Typography variant="body2" fontWeight={row.can_view ? 700 : 400}>{row.module_name}</Typography>
                              </Stack>
                            </TableCell>
                            {ACTIONS.map((a) => (
                              <TableCell key={a} align="center">
                                <Switch size="small" checked={Boolean(row[a])} disabled={!canAssignPermissions}
                                  onChange={(e) => handleDraftChange(row.module_id, a, e.target.checked)} />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <Stack direction="row" justifyContent="flex-end" spacing={1} mt={2}>
                    {selectedEmployee && (
                      <Button color="warning" variant="text" disabled={saving || !canAssignPermissions}
                        onClick={async () => {
                          if (!window.confirm(`Revoke ALL access for ${selectedEmployee.email}?`)) return;
                          setSaving(true);
                          try { await revokeEmployeeAccess(selectedEmployee.id); setModuleDraft(buildModuleDraft(modules, [])); await loadData(); setSuccess('Access revoked.'); await refreshAccess(); }
                          catch (err) { setError(err.message); } finally { setSaving(false); }
                        }}>Revoke all</Button>
                    )}
                    <Button variant="contained" size="large" disabled={saving || !canAssignPermissions || !form.email} onClick={() => void handleSaveAccess()}>
                      {saving ? 'Saving…' : 'Save Access'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </Grid>
        </Grid>
      </Stack>
    </Box>
  );
}

export default AccessManagementPage;

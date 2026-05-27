import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { usePermissions } from '../../context/PermissionContext';
import LoadingScreen from '../common/LoadingScreen';
import AccessDenied from '../auth/AccessDenied';
import { DEPARTMENT_OPTIONS } from '../../config/departments';
import {
  grantEmployeeFullAccess,
  listAllEmployeePermissions,
  listEmployeePermissionOverrides,
  listEmployees,
  listModules,
  listRoles,
  revokeEmployeeAccess,
  saveEmployee,
  saveEmployeeModuleAccess,
  setEmployeeActive,
} from '../../services/rbacService';

const emptyEmployee = {
  id: null,
  email: '',
  full_name: '',
  phone: '',
  department: '',
  role_id: '',
  is_active: true,
};

const MODULE_PRESETS = {
  sales: ['dashboard', 'sales', 'crm', 'tasks'],
  production: ['dashboard', 'production', 'inventory', 'dispatch', 'tasks'],
  accounts: ['dashboard', 'accounts', 'reports', 'tasks'],
};

function roleLabel(role) {
  return role?.role_name || role?.name || role?.code || 'Unassigned';
}

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
  const {
    canCreate,
    canEdit,
    canDelete,
    refreshAccess,
    loading: permissionsLoading,
    employee,
    authorized,
  } = usePermissions();

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

  const selectedEmployee = useMemo(
    () => employees.find((row) => row.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  const canManageEmployees =
    canCreate('employees') || canEdit('employees') || canDelete('employees');
  const canAssignPermissions = canEdit('employees');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeeRows, roleRows, moduleRows, employeePermissionRows] = await Promise.all([
        listEmployees(),
        listRoles(),
        listModules(),
        listAllEmployeePermissions(),
      ]);
      setEmployees(employeeRows);
      setRoles(roleRows);
      setModules(moduleRows);
      setAllEmployeePermissions(employeePermissionRows);
      if (!selectedEmployeeId && employeeRows[0]) {
        setSelectedEmployeeId(employeeRows[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load access management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManageEmployees) void loadData();
  }, [canManageEmployees]);

  useEffect(() => {
    if (!selectedEmployeeId) {
      setModuleDraft([]);
      return;
    }
    const emp = employees.find((row) => row.id === selectedEmployeeId);
    if (emp) {
      setForm({
        id: emp.id,
        email: emp.email || '',
        full_name: emp.full_name || '',
        phone: emp.phone || '',
        department: emp.department || '',
        role_id: emp.role_id || '',
        is_active: emp.is_active !== false,
      });
    }
    let cancelled = false;
    (async () => {
      try {
        const overrides = await listEmployeePermissionOverrides(selectedEmployeeId);
        if (!cancelled) {
          setModuleDraft(buildModuleDraft(modules, overrides));
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load permissions.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEmployeeId, employees, modules]);

  const permissionByEmployee = useMemo(() => {
    const map = new Map();
    allEmployeePermissions.forEach((permission) => {
      if (!map.has(permission.employee_id)) map.set(permission.employee_id, []);
      map.get(permission.employee_id).push(permission);
    });
    return map;
  }, [allEmployeePermissions]);

  const handleSaveEmployee = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await saveEmployee(form);
      await loadData();
      setSelectedEmployeeId(saved.id);
      setSuccess('Employee saved.');
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to save employee.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccess = async () => {
    if (!selectedEmployee) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveEmployee(form);
      await saveEmployeeModuleAccess(selectedEmployee.id, moduleDraft);
      await loadData();
      const overrides = await listEmployeePermissionOverrides(selectedEmployee.id);
      setModuleDraft(buildModuleDraft(modules, overrides));
      setSuccess(`Access saved for ${selectedEmployee.email}.`);
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to save access.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (emp) => {
    try {
      await setEmployeeActive(emp.id, !emp.is_active);
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to update employee status.');
    }
  };

  const handleDraftChange = (moduleId, field, checked) => {
    setModuleDraft((prev) =>
      prev.map((row) =>
        row.module_id === moduleId ? { ...row, [field]: checked } : row
      )
    );
  };

  const applyPreset = (presetKey) => {
    const keys = MODULE_PRESETS[presetKey] || [];
    setModuleDraft((prev) =>
      prev.map((row) => ({
        ...row,
        can_view: keys.includes(row.module_key),
        can_create: keys.includes(row.module_key) && row.module_key !== 'dashboard',
        can_edit: false,
        can_delete: false,
      }))
    );
  };

  const handleFullAccess = async () => {
    if (!selectedEmployee) return;
    setSaving(true);
    try {
      await grantEmployeeFullAccess(selectedEmployee.id, modules);
      const overrides = await listEmployeePermissionOverrides(selectedEmployee.id);
      setModuleDraft(buildModuleDraft(modules, overrides));
      setSuccess('Full access granted.');
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to grant full access.');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeAccess = async () => {
    if (!selectedEmployee || !window.confirm(`Revoke all ERP access for ${selectedEmployee.email}?`)) return;
    setSaving(true);
    try {
      await revokeEmployeeAccess(selectedEmployee.id);
      setModuleDraft(buildModuleDraft(modules, []));
      setSuccess('Access revoked.');
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to revoke access.');
    } finally {
      setSaving(false);
    }
  };

  if (permissionsLoading) {
    return <LoadingScreen message="Loading access management…" />;
  }

  if (!authorized || !employee) {
    return <AccessDenied />;
  }

  if (!canManageEmployees) {
    return <Alert severity="error">Access Denied. Please contact CEO/Admin.</Alert>;
  }

  if (loading) {
    return <LoadingScreen message="Loading employees and permissions…" />;
  }

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Employee Access Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Assign department, role, and module access. Employees only see allowed modules after login.
          </Typography>
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {form.id ? 'Edit Employee' : 'Add Employee'}
                  </Typography>
                  <TextField label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth />
                  <TextField label="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} fullWidth />
                  <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth />
                  <FormControl fullWidth>
                    <InputLabel>Department</InputLabel>
                    <Select
                      label="Department"
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                    >
                      {DEPARTMENT_OPTIONS.map((dept) => (
                        <MenuItem key={dept} value={dept}>{dept}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth>
                    <InputLabel>Role (designation)</InputLabel>
                    <Select label="Role (designation)" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
                      {roles.map((role) => (
                        <MenuItem key={role.id} value={role.id}>{roleLabel(role)}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="body2">Active</Typography>
                    <Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  </Stack>
                  <Button variant="contained" onClick={() => void handleSaveEmployee()} disabled={saving}>
                    Save Employee
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={8}>
            <Paper variant="outlined" sx={{ overflow: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Department</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Modules</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {employees.map((emp) => {
                    const allowed = (permissionByEmployee.get(emp.id) || [])
                      .filter((p) => p.can_view)
                      .map((p) => p.modules?.module_name)
                      .filter(Boolean);
                    return (
                      <TableRow
                        key={emp.id}
                        selected={emp.id === selectedEmployeeId}
                        hover
                        onClick={() => setSelectedEmployeeId(emp.id)}
                      >
                        <TableCell>{emp.full_name || '—'}</TableCell>
                        <TableCell>{emp.email}</TableCell>
                        <TableCell>{emp.department || '—'}</TableCell>
                        <TableCell>{roleLabel(emp.roles)}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {allowed.slice(0, 4).map((name) => (
                              <Chip key={name} size="small" label={name} />
                            ))}
                            {allowed.length > 4 && <Chip size="small" label={`+${allowed.length - 4}`} />}
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={(e) => { e.stopPropagation(); setSelectedEmployeeId(emp.id); }}>
                            Manage
                          </Button>
                          <Button size="small" color={emp.is_active ? 'warning' : 'success'} onClick={(e) => { e.stopPropagation(); void handleToggleActive(emp); }}>
                            {emp.is_active ? 'Disable' : 'Enable'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Paper>
          </Grid>
        </Grid>

        {selectedEmployee && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Module access — {selectedEmployee.full_name || selectedEmployee.email}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button size="small" variant="outlined" onClick={() => applyPreset('sales')}>Sales preset</Button>
                  <Button size="small" variant="outlined" onClick={() => applyPreset('production')}>Production preset</Button>
                  <Button size="small" variant="outlined" onClick={() => applyPreset('accounts')}>Accounts preset</Button>
                  <Button size="small" variant="outlined" onClick={() => void handleFullAccess()} disabled={!canAssignPermissions}>Grant full access</Button>
                  <Button size="small" color="warning" variant="outlined" onClick={() => void handleRevokeAccess()} disabled={!canAssignPermissions}>Revoke all</Button>
                </Stack>
                <Paper variant="outlined" sx={{ overflow: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Module</TableCell>
                        <TableCell>View</TableCell>
                        <TableCell>Create</TableCell>
                        <TableCell>Edit</TableCell>
                        <TableCell>Delete</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {moduleDraft.map((row) => (
                        <TableRow key={row.module_id}>
                          <TableCell>{row.module_name}</TableCell>
                          {['can_view', 'can_create', 'can_edit', 'can_delete'].map((field) => (
                            <TableCell key={field}>
                              <Switch
                                size="small"
                                checked={Boolean(row[field])}
                                disabled={!canAssignPermissions}
                                onChange={(e) => handleDraftChange(row.module_id, field, e.target.checked)}
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
                <Button
                  variant="contained"
                  size="large"
                  disabled={saving || !canAssignPermissions}
                  onClick={() => void handleSaveAccess()}
                >
                  {saving ? 'Saving…' : 'Save Access'}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  );
}

export default AccessManagementPage;

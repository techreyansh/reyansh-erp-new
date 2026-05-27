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
import {
  deleteEmployeePermissionOverride,
  listEmployeePermissionOverrides,
  listEmployees,
  listModules,
  listRoleModulePermissions,
  listRoles,
  saveEmployee,
  setEmployeeActive,
  upsertEmployeePermission,
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

function roleLabel(role) {
  return role?.role_name || role?.name || role?.code || 'Unassigned';
}

function AccessManagementPage() {
  const { isCEO, isAdmin, refreshAccess } = usePermissions();
  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [modules, setModules] = useState([]);
  const [rolePermissions, setRolePermissions] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [form, setForm] = useState(emptyEmployee);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeeRows, roleRows, moduleRows, rolePermissionRows] = await Promise.all([
        listEmployees(),
        listRoles(),
        listModules(),
        listRoleModulePermissions(),
      ]);
      setEmployees(employeeRows);
      setRoles(roleRows);
      setModules(moduleRows);
      setRolePermissions(rolePermissionRows);
      if (!selectedEmployeeId && employeeRows[0]) {
        setSelectedEmployeeId(employeeRows[0].id);
      }
    } catch (err) {
      console.error('[AccessManagement] load failed:', err);
      setError(err.message || 'Failed to load access management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!selectedEmployeeId) {
      setOverrides([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listEmployeePermissionOverrides(selectedEmployeeId);
        if (!cancelled) setOverrides(rows);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load permission overrides.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEmployeeId]);

  const startEdit = (employee) => {
    setForm({
      id: employee?.id || null,
      email: employee?.email || '',
      full_name: employee?.full_name || '',
      phone: employee?.phone || '',
      department: employee?.department || '',
      role_id: employee?.role_id || '',
      is_active: employee?.is_active !== false,
    });
  };

  const resetForm = () => setForm(emptyEmployee);

  const handleSaveEmployee = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveEmployee(form);
      await loadData();
      setSelectedEmployeeId(saved.id);
      resetForm();
      await refreshAccess();
    } catch (err) {
      setError(err.message || 'Failed to save employee.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (employee) => {
    setError(null);
    try {
      await setEmployeeActive(employee.id, !employee.is_active);
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to update employee status.');
    }
  };

  const overrideByModule = useMemo(() => {
    const map = new Map();
    overrides.forEach((override) => map.set(override.module_id, override));
    return map;
  }, [overrides]);

  const rolePermissionByRoleModule = useMemo(() => {
    const map = new Map();
    rolePermissions.forEach((permission) => {
      map.set(`${permission.role_id}:${permission.module_id}`, permission);
    });
    return map;
  }, [rolePermissions]);

  const handleOverrideChange = async (moduleId, field, checked) => {
    if (!selectedEmployee) return;
    const current = overrideByModule.get(moduleId) || {};
    const next = {
      can_view: current.can_view ?? false,
      can_create: current.can_create ?? false,
      can_edit: current.can_edit ?? false,
      can_delete: current.can_delete ?? false,
      [field]: checked,
    };
    try {
      await upsertEmployeePermission(selectedEmployee.id, moduleId, next);
      setOverrides(await listEmployeePermissionOverrides(selectedEmployee.id));
    } catch (err) {
      setError(err.message || 'Failed to update override.');
    }
  };

  const clearOverride = async (permissionId) => {
    try {
      await deleteEmployeePermissionOverride(permissionId);
      setOverrides(await listEmployeePermissionOverrides(selectedEmployee.id));
    } catch (err) {
      setError(err.message || 'Failed to clear override.');
    }
  };

  if (!isAdmin) {
    return (
      <Alert severity="error">
        Access Denied. Please contact CEO/Admin.
      </Alert>
    );
  }

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Access Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage authorized employees, roles, module access, and per-employee overrides.
          </Typography>
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

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
                  <TextField label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} fullWidth />
                  <FormControl fullWidth>
                    <InputLabel>Role</InputLabel>
                    <Select label="Role" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
                      {roles.map((role) => (
                        <MenuItem key={role.id} value={role.id}>
                          {roleLabel(role)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="body2">Active</Typography>
                    <Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={handleSaveEmployee} disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                    <Button variant="outlined" onClick={resetForm}>Clear</Button>
                  </Stack>
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
                    <TableCell>Role</TableCell>
                    <TableCell>Modules</TableCell>
                    <TableCell>Active</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {employees.map((employee) => {
                    const allowedModules = rolePermissions
                      .filter((permission) => permission.role_id === employee.role_id && permission.can_view)
                      .map((permission) => permission.modules?.module_name)
                      .filter(Boolean);
                    return (
                      <TableRow
                        key={employee.id}
                        selected={employee.id === selectedEmployeeId}
                        hover
                        onClick={() => setSelectedEmployeeId(employee.id)}
                      >
                        <TableCell>{employee.full_name || '-'}</TableCell>
                        <TableCell>{employee.email}</TableCell>
                        <TableCell>{roleLabel(employee.roles)}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {allowedModules.slice(0, 5).map((moduleName) => (
                              <Chip key={moduleName} size="small" label={moduleName} />
                            ))}
                            {allowedModules.length > 5 && <Chip size="small" label={`+${allowedModules.length - 5}`} />}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" color={employee.is_active ? 'success' : 'default'} label={employee.is_active ? 'Active' : 'Disabled'} />
                        </TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={(e) => { e.stopPropagation(); startEdit(employee); }}>
                            Edit
                          </Button>
                          <Button size="small" color={employee.is_active ? 'warning' : 'success'} onClick={(e) => { e.stopPropagation(); void handleToggleActive(employee); }}>
                            {employee.is_active ? 'Disable' : 'Enable'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!loading && employees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>No employees found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </Grid>
        </Grid>

        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Employee Access Matrix
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedEmployee ? `Overrides for ${selectedEmployee.email}` : 'Select an employee to manage overrides.'}
                </Typography>
              </Box>

              {selectedEmployee && (
                <Paper variant="outlined" sx={{ overflow: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Module</TableCell>
                        <TableCell>Role View</TableCell>
                        <TableCell>View</TableCell>
                        <TableCell>Create</TableCell>
                        <TableCell>Edit</TableCell>
                        <TableCell>Delete</TableCell>
                        <TableCell>Override</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {modules.map((module) => {
                        const rolePermission = rolePermissionByRoleModule.get(`${selectedEmployee.role_id}:${module.id}`);
                        const override = overrideByModule.get(module.id);
                        return (
                          <TableRow key={module.id}>
                            <TableCell>{module.module_name}</TableCell>
                            <TableCell>{rolePermission?.can_view ? 'Yes' : 'No'}</TableCell>
                            {['can_view', 'can_create', 'can_edit', 'can_delete'].map((field) => (
                              <TableCell key={field}>
                                <Switch
                                  size="small"
                                  checked={Boolean(override?.[field])}
                                  onChange={(e) => void handleOverrideChange(module.id, field, e.target.checked)}
                                  disabled={!isCEO}
                                />
                              </TableCell>
                            ))}
                            <TableCell>
                              {override ? (
                                <Button size="small" color="warning" disabled={!isCEO} onClick={() => void clearOverride(override.id)}>
                                  Clear
                                </Button>
                              ) : (
                                <Typography variant="caption" color="text.secondary">Role default</Typography>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Paper>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

export default AccessManagementPage;

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { usePermissions } from '../../context/PermissionContext';
import LoadingScreen from '../common/LoadingScreen';
import AccessDenied from '../auth/AccessDenied';
import { DEPARTMENT_OPTIONS } from '../../config/departments';
import { listEmployeesByDepartment } from '../../services/rbacService';
import { createTask } from '../../services/taskService';

const emptyTask = {
  title: '',
  description: '',
  assigned_to: '',
  priority: 'medium',
  due_date: '',
  department: '',
};

const priorities = ['low', 'medium', 'high', 'urgent'];

function TaskScheduler() {
  const { employee, canCreate, loading: permissionsLoading, authorized } = usePermissions();
  const [stepDepartment, setStepDepartment] = useState('');
  const [departmentEmployees, setDepartmentEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [form, setForm] = useState(emptyTask);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const canAssign = canCreate('tasks');

  useEffect(() => {
    if (!stepDepartment) {
      setDepartmentEmployees([]);
      setForm((prev) => ({ ...prev, department: '', assigned_to: '' }));
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingEmployees(true);
      setError(null);
      try {
        const rows = await listEmployeesByDepartment(stepDepartment);
        if (!cancelled) {
          setDepartmentEmployees(rows);
          setForm((prev) => ({
            ...prev,
            department: stepDepartment,
            assigned_to: '',
          }));
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load employees for department.');
      } finally {
        if (!cancelled) setLoadingEmployees(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stepDepartment]);

  const selectedEmployee = useMemo(
    () => departmentEmployees.find((row) => row.id === form.assigned_to) || null,
    [departmentEmployees, form.assigned_to]
  );

  const handleAssign = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (!form.title?.trim()) throw new Error('Task title is required.');
      if (!form.assigned_to) throw new Error('Select an employee to assign the task.');
      await createTask(
        {
          ...form,
          department: stepDepartment || form.department,
        },
        employee?.id,
        selectedEmployee
      );
      setSuccess('Task assigned successfully.');
      setForm({ ...emptyTask, department: stepDepartment });
    } catch (err) {
      setError(err.message || 'Failed to assign task.');
    } finally {
      setSaving(false);
    }
  };

  if (permissionsLoading) {
    return <LoadingScreen message="Loading task scheduler…" />;
  }

  if (!authorized || !employee) {
    return <AccessDenied />;
  }

  if (!canAssign) {
    return (
      <Alert severity="warning">
        You do not have permission to assign tasks. Contact your administrator.
      </Alert>
    );
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Task Scheduler
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Select department, choose employee, then assign a task with priority and deadline.
          </Typography>
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

        <Card>
          <CardContent>
            <Stack spacing={3}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Step 1 — Department
              </Typography>
              <FormControl fullWidth>
                <InputLabel>Department</InputLabel>
                <Select
                  label="Department"
                  value={stepDepartment}
                  onChange={(e) => setStepDepartment(e.target.value)}
                >
                  {DEPARTMENT_OPTIONS.map((dept) => (
                    <MenuItem key={dept} value={dept}>
                      {dept}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {stepDepartment && (
                <>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Step 2 — Employee
                  </Typography>
                  <FormControl fullWidth disabled={loadingEmployees}>
                    <InputLabel>Employee</InputLabel>
                    <Select
                      label="Employee"
                      value={form.assigned_to}
                      onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                    >
                      {departmentEmployees.map((row) => (
                        <MenuItem key={row.id} value={row.id}>
                          {row.full_name || row.email}
                          {row.roles ? ` — ${row.roles.role_name || row.roles.code || ''}` : ''}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {!loadingEmployees && departmentEmployees.length === 0 && (
                    <Alert severity="info">No active employees in {stepDepartment}.</Alert>
                  )}
                </>
              )}

              {form.assigned_to && (
                <>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Step 3 — Task details
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        label="Task title"
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        fullWidth
                        required
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Priority</InputLabel>
                        <Select
                          label="Priority"
                          value={form.priority}
                          onChange={(e) => setForm({ ...form, priority: e.target.value })}
                        >
                          {priorities.map((p) => (
                            <MenuItem key={p} value={p}>
                              {p}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        label="Deadline"
                        type="date"
                        value={form.due_date}
                        onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="Description"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        fullWidth
                        multiline
                        minRows={3}
                      />
                    </Grid>
                  </Grid>
                  {selectedEmployee && (
                    <Typography variant="body2" color="text.secondary">
                      Assigning to: {selectedEmployee.full_name || selectedEmployee.email} ({stepDepartment})
                    </Typography>
                  )}
                  <Button variant="contained" onClick={() => void handleAssign()} disabled={saving}>
                    {saving ? 'Saving…' : 'Assign Task'}
                  </Button>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

export default TaskScheduler;

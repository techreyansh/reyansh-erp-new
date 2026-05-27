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
import { listEmployees } from '../../services/rbacService';
import { createTask, deleteTask, listTasks, updateMyTaskStatus, updateTask } from '../../services/taskService';

const emptyTask = {
  title: '',
  description: '',
  assigned_to: '',
  priority: 'medium',
  due_date: '',
  task_status: 'pending',
  department: '',
};

const statuses = ['pending', 'in_progress', 'completed', 'blocked'];
const priorities = ['low', 'medium', 'high', 'urgent'];

function statusColor(status) {
  if (status === 'completed') return 'success';
  if (status === 'blocked') return 'error';
  if (status === 'in_progress') return 'info';
  return 'warning';
}

function TaskDashboard() {
  const {
    employee,
    canCreate,
    canEdit,
    canDelete,
    loading: permissionsLoading,
    authorized,
  } = usePermissions();
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(emptyTask);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const canManageTasks = canCreate('tasks') || canEdit('tasks') || canDelete('tasks');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskRows, employeeRows] = await Promise.all([
        listTasks(),
        canManageTasks ? listEmployees() : Promise.resolve([]),
      ]);
      setTasks(taskRows);
      setEmployees(employeeRows.filter((row) => row.is_active));
    } catch (err) {
      console.error('[TaskDashboard] load failed:', err);
      setError(err.message || 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [canManageTasks]);

  const departmentOptions = useMemo(() => {
    return Array.from(new Set(employees.map((row) => row.department).filter(Boolean))).sort();
  }, [employees]);

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!form.assigned_to && form.department) {
        const departmentEmployees = employees.filter((row) => row.department === form.department);
        if (!departmentEmployees.length) {
          throw new Error('No active employees found for that department.');
        }
        await Promise.all(
          departmentEmployees.map((row) =>
            createTask({ ...form, assigned_to: row.id }, employee?.id, row)
          )
        );
      } else {
        const assignee = employees.find((row) => row.id === form.assigned_to) || null;
        await createTask(form, employee?.id, assignee);
      }
      setForm(emptyTask);
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (task, nextStatus) => {
    setError(null);
    try {
      if (canManageTasks) {
        await updateTask(task.id, { task_status: nextStatus });
      } else {
        await updateMyTaskStatus(task.id, nextStatus, employee?.email);
      }
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to update task status.');
    }
  };

  const handleDelete = async (taskId) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await deleteTask(taskId);
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to delete task.');
    }
  };

  if (permissionsLoading) {
    return <LoadingScreen message="Loading task dashboard…" />;
  }

  if (!authorized || !employee) {
    return <AccessDenied />;
  }

  if (loading) {
    return <LoadingScreen message="Loading tasks…" />;
  }

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Task Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Track assigned work, deadlines, priority, and completion status.
          </Typography>
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        {canManageTasks && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Assign Task</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <FormControl fullWidth>
                      <InputLabel>Assign employee</InputLabel>
                      <Select label="Assign employee" value={form.assigned_to} onChange={(e) => {
                        const selected = employees.find((row) => row.id === e.target.value);
                        setForm({ ...form, assigned_to: e.target.value, department: selected?.department || form.department });
                      }}>
                        <MenuItem value="">
                          Assign by department
                        </MenuItem>
                        {employees.map((row) => (
                          <MenuItem key={row.id} value={row.id}>
                            {row.full_name || row.email} {row.department ? `(${row.department})` : ''}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <FormControl fullWidth>
                      <InputLabel>Priority</InputLabel>
                      <Select label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                        {priorities.map((priority) => <MenuItem key={priority} value={priority}>{priority}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <TextField label="Due date" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} fullWidth helperText={departmentOptions.length ? `Known: ${departmentOptions.join(', ')}` : 'Optional'} />
                  </Grid>
                  <Grid item xs={12} md={8}>
                    <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline minRows={2} />
                  </Grid>
                </Grid>
                <Box>
                  <Button variant="contained" onClick={handleCreate} disabled={saving}>
                    {saving ? 'Assigning...' : 'Assign Task'}
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}

        <Paper variant="outlined" sx={{ overflow: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Task</TableCell>
                <TableCell>Assignee</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Due</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Typography variant="subtitle2">{task.title}</Typography>
                    {task.description && <Typography variant="caption" color="text.secondary">{task.description}</Typography>}
                  </TableCell>
                  <TableCell>{task.assignee?.full_name || task.assignee?.email || '-'}</TableCell>
                  <TableCell>{task.department || task.assignee?.department || '-'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={task.priority} color={task.priority === 'urgent' ? 'error' : task.priority === 'high' ? 'warning' : 'default'} />
                  </TableCell>
                  <TableCell>{task.due_date || '-'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={task.task_status} color={statusColor(task.task_status)} />
                  </TableCell>
                  <TableCell align="right">
                    <FormControl size="small" sx={{ minWidth: 150, mr: 1 }}>
                      <Select value={task.task_status} onChange={(e) => void handleStatusChange(task, e.target.value)}>
                        {statuses.map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
                      </Select>
                    </FormControl>
                    {canManageTasks && (
                      <Button size="small" color="error" onClick={() => void handleDelete(task.id)}>
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>No tasks found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </Stack>
    </Box>
  );
}

export default TaskDashboard;

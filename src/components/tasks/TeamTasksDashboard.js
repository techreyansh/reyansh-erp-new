import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { DEPARTMENT_OPTIONS } from '../../config/departments';
import { listEmployees, listEmployeesByDepartment } from '../../services/rbacService';
import {
  deleteTask,
  isTaskOverdue,
  listTasks,
  updateTask,
} from '../../services/taskService';

const statuses = ['pending', 'in_progress', 'completed', 'blocked'];
const priorities = ['low', 'medium', 'high', 'urgent'];

function statusColor(status) {
  if (status === 'completed') return 'success';
  if (status === 'blocked') return 'error';
  if (status === 'in_progress') return 'info';
  return 'warning';
}

const emptyEdit = {
  id: null,
  title: '',
  description: '',
  assigned_to: '',
  priority: 'medium',
  due_date: '',
  task_status: 'pending',
  department: '',
};

function TeamTasksDashboard() {
  const {
    employee,
    canEdit,
    canDelete,
    loading: permissionsLoading,
    authorized,
    canManageTasks,
  } = usePermissions();

  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskRows, employeeRows] = await Promise.all([
        listTasks(),
        canManageTasks ? listEmployees() : Promise.resolve([]),
      ]);
      setTasks(taskRows);
      setEmployees((employeeRows || []).filter((row) => row.is_active));
    } catch (err) {
      setError(err.message || 'Failed to load team tasks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManageTasks) void loadData();
  }, [canManageTasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const dept = task.department || task.assignee?.department || '';
      if (filterDepartment && dept !== filterDepartment) return false;
      if (filterEmployee && task.assigned_to !== filterEmployee) return false;
      return true;
    });
  }, [tasks, filterDepartment, filterEmployee]);

  const openEdit = (task) => {
    setEditForm({
      id: task.id,
      title: task.title || '',
      description: task.description || '',
      assigned_to: task.assigned_to || '',
      priority: task.priority || 'medium',
      due_date: task.due_date || '',
      task_status: task.task_status || 'pending',
      department: task.department || task.assignee?.department || '',
    });
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editForm.id) return;
    setSaving(true);
    setError(null);
    try {
      const selected = employees.find((row) => row.id === editForm.assigned_to);
      await updateTask(editForm.id, {
        title: editForm.title,
        description: editForm.description,
        assigned_to: editForm.assigned_to,
        assigned_email: selected?.email ? String(selected.email).trim().toLowerCase() : null,
        assigned_name: selected?.full_name || null,
        priority: editForm.priority,
        due_date: editForm.due_date || null,
        task_status: editForm.task_status,
        department: editForm.department || selected?.department || null,
      });
      setEditOpen(false);
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to update task.');
    } finally {
      setSaving(false);
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

  const handleReassignDepartment = async (department) => {
    if (!editForm.id || !department) return;
    const rows = await listEmployeesByDepartment(department);
    if (!rows[0]) {
      setError(`No active employees in ${department}.`);
      return;
    }
    setEditForm((prev) => ({
      ...prev,
      department,
      assigned_to: rows[0].id,
    }));
  };

  if (permissionsLoading) {
    return <LoadingScreen message="Loading team tasks…" />;
  }

  if (!authorized || !employee) {
    return <AccessDenied />;
  }

  if (!canManageTasks) {
    return (
      <Alert severity="warning">
        You do not have permission to view all team tasks.
      </Alert>
    );
  }

  if (loading) {
    return <LoadingScreen message="Loading team tasks…" />;
  }

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Team Tasks
          </Typography>
          <Typography variant="body2" color="text.secondary">
            View, filter, edit, and reassign tasks across departments.
          </Typography>
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Filter department</InputLabel>
                <Select
                  label="Filter department"
                  value={filterDepartment}
                  onChange={(e) => {
                    setFilterDepartment(e.target.value);
                    setFilterEmployee('');
                  }}
                >
                  <MenuItem value="">All departments</MenuItem>
                  {DEPARTMENT_OPTIONS.map((dept) => (
                    <MenuItem key={dept} value={dept}>
                      {dept}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Filter employee</InputLabel>
                <Select
                  label="Filter employee"
                  value={filterEmployee}
                  onChange={(e) => setFilterEmployee(e.target.value)}
                >
                  <MenuItem value="">All employees</MenuItem>
                  {employees
                    .filter((row) => !filterDepartment || row.department === filterDepartment)
                    .map((row) => (
                      <MenuItem key={row.id} value={row.id}>
                        {row.full_name || row.email}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4} sx={{ display: 'flex', alignItems: 'center' }}>
              <Chip label={`${filteredTasks.length} task(s)`} />
            </Grid>
          </Grid>
        </Paper>

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
              {filteredTasks.map((task) => (
                <TableRow key={task.id} sx={isTaskOverdue(task) ? { bgcolor: 'rgba(211, 47, 47, 0.06)' } : undefined}>
                  <TableCell>
                    <Typography variant="subtitle2">{task.title}</Typography>
                    {task.description && (
                      <Typography variant="caption" color="text.secondary">
                        {task.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{task.assignee?.full_name || task.assignee?.email || '—'}</TableCell>
                  <TableCell>{task.department || task.assignee?.department || '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={task.priority} />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <span>{task.due_date || '—'}</span>
                      {isTaskOverdue(task) && <Chip size="small" color="error" label="Overdue" />}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={task.task_status} color={statusColor(task.task_status)} />
                  </TableCell>
                  <TableCell align="right">
                    {canEdit('tasks') && (
                      <Button size="small" onClick={() => openEdit(task)}>
                        Edit
                      </Button>
                    )}
                    {canDelete('tasks') && (
                      <Button size="small" color="error" onClick={() => void handleDelete(task.id)}>
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filteredTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>No tasks match the current filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </Stack>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit / Reassign Task</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Title"
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              fullWidth
            />
            <TextField
              label="Description"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              fullWidth
              multiline
              minRows={2}
            />
            <FormControl fullWidth>
              <InputLabel>Department</InputLabel>
              <Select
                label="Department"
                value={editForm.department}
                onChange={(e) => void handleReassignDepartment(e.target.value)}
              >
                {DEPARTMENT_OPTIONS.map((dept) => (
                  <MenuItem key={dept} value={dept}>
                    {dept}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Assignee</InputLabel>
              <Select
                label="Assignee"
                value={editForm.assigned_to}
                onChange={(e) => setEditForm({ ...editForm, assigned_to: e.target.value })}
              >
                {employees
                  .filter((row) => !editForm.department || row.department === editForm.department)
                  .map((row) => (
                    <MenuItem key={row.id} value={row.id}>
                      {row.full_name || row.email}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                label="Priority"
                value={editForm.priority}
                onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
              >
                {priorities.map((p) => (
                  <MenuItem key={p} value={p}>
                    {p}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Due date"
              type="date"
              value={editForm.due_date}
              onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={editForm.task_status}
                onChange={(e) => setEditForm({ ...editForm, task_status: e.target.value })}
              >
                {statuses.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleSaveEdit()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default TeamTasksDashboard;

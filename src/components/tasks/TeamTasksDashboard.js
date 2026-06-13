import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded';
import InboxRoundedIcon from '@mui/icons-material/InboxRounded';
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

function priorityColor(priority) {
  if (priority === 'urgent') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'default';
}

/** "in_progress" -> "In progress" */
function humanize(value) {
  if (!value) return '';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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

  const hasFilters = Boolean(filterDepartment || filterEmployee);
  const employeeOptions = employees.filter(
    (row) => !filterDepartment || row.department === filterDepartment
  );
  const overdueCount = filteredTasks.filter((t) => isTaskOverdue(t)).length;

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar
            variant="rounded"
            sx={{
              bgcolor: 'primary.main',
              width: 48,
              height: 48,
              boxShadow: (t) => `0 6px 16px ${t.palette.primary.main}33`,
            }}
          >
            <AssignmentOutlinedIcon />
          </Avatar>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
              Team Tasks
            </Typography>
            <Typography variant="body2" color="text.secondary">
              View, filter, edit, and reassign tasks across departments.
            </Typography>
          </Box>
        </Stack>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        <Paper
          variant="outlined"
          sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2.5, bgcolor: 'background.paper' }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', pr: 0.5 }}>
              <FilterListRoundedIcon fontSize="small" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                Filters
              </Typography>
            </Stack>

            <FormControl size="small" sx={{ minWidth: 220, flex: { md: 1 } }}>
              <InputLabel>Department</InputLabel>
              <Select
                label="Department"
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

            <FormControl size="small" sx={{ minWidth: 220, flex: { md: 1 } }}>
              <InputLabel>Employee</InputLabel>
              <Select
                label="Employee"
                value={filterEmployee}
                onChange={(e) => setFilterEmployee(e.target.value)}
              >
                <MenuItem value="">All employees</MenuItem>
                {employeeOptions.map((row) => (
                  <MenuItem key={row.id} value={row.id}>
                    {row.full_name || row.email}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {hasFilters && (
              <Button
                size="small"
                color="inherit"
                startIcon={<ClearRoundedIcon />}
                onClick={() => {
                  setFilterDepartment('');
                  setFilterEmployee('');
                }}
                sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}
              >
                Clear
              </Button>
            )}

            <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'block' } }} />

            <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
              {overdueCount > 0 && (
                <Chip
                  size="small"
                  color="error"
                  variant="outlined"
                  icon={<EventBusyRoundedIcon />}
                  label={`${overdueCount} overdue`}
                  sx={{ fontWeight: 600 }}
                />
              )}
              <Chip
                label={`${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'}`}
                color="primary"
                sx={{ fontWeight: 700 }}
              />
            </Stack>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: 'calc(100vh - 320px)' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow
                  sx={{
                    '& th': {
                      bgcolor: 'grey.50',
                      color: 'text.secondary',
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      borderBottom: (t) => `1px solid ${t.palette.divider}`,
                      py: 1.25,
                    },
                  }}
                >
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
                {filteredTasks.map((task) => {
                  const overdue = isTaskOverdue(task);
                  const assigneeName = task.assignee?.full_name || task.assignee?.email || '';
                  return (
                    <TableRow
                      key={task.id}
                      hover
                      sx={{
                        '& td': { borderColor: 'divider', py: 1.25 },
                        ...(overdue && {
                          bgcolor: (t) => `${t.palette.error.main}0a`,
                          '&:hover': { bgcolor: (t) => `${t.palette.error.main}14` },
                        }),
                      }}
                    >
                      <TableCell sx={{ maxWidth: 360 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                          {task.title}
                        </Typography>
                        {task.description && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {task.description}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {assigneeName ? (
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Avatar
                              sx={{
                                width: 28,
                                height: 28,
                                fontSize: 12,
                                fontWeight: 700,
                                bgcolor: 'secondary.main',
                              }}
                            >
                              {initialsOf(assigneeName)}
                            </Avatar>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {assigneeName}
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.disabled">
                            Unassigned
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {task.department || task.assignee?.department || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={humanize(task.priority)}
                          color={priorityColor(task.priority)}
                          sx={{ fontWeight: 600 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          alignItems="center"
                          useFlexGap
                          flexWrap="wrap"
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              whiteSpace: 'nowrap',
                              fontWeight: overdue ? 700 : 400,
                              color: overdue ? 'error.main' : 'text.primary',
                            }}
                          >
                            {task.due_date || '—'}
                          </Typography>
                          {overdue && (
                            <Chip size="small" color="error" label="Overdue" sx={{ height: 20 }} />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={humanize(task.task_status)}
                          color={statusColor(task.task_status)}
                          sx={{ fontWeight: 600 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          {canEdit('tasks') && (
                            <Tooltip title="Edit / reassign">
                              <IconButton size="small" color="primary" onClick={() => openEdit(task)}>
                                <EditOutlinedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {canDelete('tasks') && (
                            <Tooltip title="Delete">
                              <IconButton size="small" color="error" onClick={() => void handleDelete(task.id)}>
                                <DeleteOutlineRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredTasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ border: 0 }}>
                      <Stack alignItems="center" spacing={1.5} sx={{ py: 6, color: 'text.secondary' }}>
                        <InboxRoundedIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          No tasks found
                        </Typography>
                        <Typography variant="body2" sx={{ maxWidth: 320, textAlign: 'center' }}>
                          {hasFilters
                            ? 'No tasks match the current filters. Try clearing them to see everything.'
                            : 'There are no team tasks yet.'}
                        </Typography>
                        {hasFilters && (
                          <Button
                            size="small"
                            startIcon={<ClearRoundedIcon />}
                            onClick={() => {
                              setFilterDepartment('');
                              setFilterEmployee('');
                            }}
                          >
                            Clear filters
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
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

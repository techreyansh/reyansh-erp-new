import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  FormControl,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionContext';
import LoadingScreen from '../common/LoadingScreen';
import AccessDenied from '../auth/AccessDenied';
import { isTaskOverdue, listMyTasks, updateMyTaskStatus } from '../../services/taskService';

const statuses = ['pending', 'in_progress', 'completed', 'blocked'];

function statusColor(status) {
  if (status === 'completed') return 'success';
  if (status === 'blocked') return 'error';
  if (status === 'in_progress') return 'info';
  return 'warning';
}

function MyTasksView() {
  const { user } = useAuth();
  const { employee, loading: permissionsLoading, authorized } = usePermissions();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const employeeEmail = employee?.email || user?.email || '';

  const loadTasks = async () => {
    if (!employeeEmail) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listMyTasks(employeeEmail);
      setTasks(rows);
    } catch (err) {
      setError(err.message || 'Failed to load your tasks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (employeeEmail) void loadTasks();
  }, [employeeEmail]);

  const handleStatusChange = async (taskId, nextStatus) => {
    setError(null);
    try {
      await updateMyTaskStatus(taskId, nextStatus, employeeEmail);
      await loadTasks();
    } catch (err) {
      setError(err.message || 'Failed to update status.');
    }
  };

  if (permissionsLoading) {
    return <LoadingScreen message="Loading your tasks…" />;
  }

  if (!authorized || !employee) {
    return <AccessDenied />;
  }

  if (loading) {
    return <LoadingScreen message="Loading your tasks…" />;
  }

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            My Tasks
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tasks assigned to you. You can update status only.
          </Typography>
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        <Paper variant="outlined" sx={{ overflow: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Deadline</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Update status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Typography variant="subtitle2">{task.title}</Typography>
                    {task.description && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {task.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={task.priority} />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{task.due_date || '—'}</span>
                      {isTaskOverdue(task) && <Chip size="small" color="error" label="Overdue" />}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={task.task_status} color={statusColor(task.task_status)} />
                  </TableCell>
                  <TableCell>
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <Select
                        value={task.task_status}
                        onChange={(e) => void handleStatusChange(task.id, e.target.value)}
                      >
                        {statuses.map((status) => (
                          <MenuItem key={status} value={status}>
                            {status}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                </TableRow>
              ))}
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>No tasks assigned to you yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </Stack>
    </Box>
  );
}

export default MyTasksView;

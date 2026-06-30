// Order-to-Dispatch — Department Workboard.
// Each department sees only the workflow tasks the engine spawned for it.
// Managers/CEO get a department selector (incl. "All"); others are locked to
// their own department. Completing a task advances the order's workflow.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Paper, Typography, Chip, Stack, Button, LinearProgress, Alert,
  Select, MenuItem, FormControl, InputLabel, Divider, Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { usePermissions } from '../../context/PermissionContext';
import workflowEngineService from '../../services/workflowEngineService';
import { isManualStage, waitingOn } from './workflowLabels';

const DEPARTMENTS = ['Production', 'Dispatch', 'PPC', 'CRM', 'Store'];
const PRIORITY_COLOR = { urgent: 'error', high: 'warning', medium: 'default', low: 'default' };

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function groupByStatus(tasks) {
  const today = startOfToday();
  const g = { overdue: [], today: [], upcoming: [], done: [] };
  (tasks || []).forEach((t) => {
    if (t.task_status === 'completed') { g.done.push(t); return; }
    if (t.due_date) {
      const due = new Date(t.due_date);
      if (due < today) { g.overdue.push(t); return; }
      if (isSameDay(due, today)) { g.today.push(t); return; }
    }
    g.upcoming.push(t);
  });
  return g;
}

function TaskCard({ task, onComplete, busy }) {
  const inst = task.stage?.instance;
  const accent = task.task_status === 'completed' ? 'success.main'
    : (task.due_date && new Date(task.due_date) < startOfToday()) ? 'error.main' : 'primary.main';
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderLeft: 4, borderColor: accent }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>{task.stage?.label || task.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {inst?.so_number || '—'} · {inst?.company_name || inst?.sales_order_id?.slice(0, 8) || ''}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={task.department || '—'} />
            <Chip size="small" label={task.priority || 'medium'} color={PRIORITY_COLOR[task.priority] || 'default'} variant="outlined" />
            {task.due_date && <Chip size="small" variant="outlined" label={`due ${task.due_date}`} />}
            <Chip size="small" variant="outlined" label={task.task_status} />
          </Stack>
        </Box>
        <Stack spacing={0.5} alignItems="flex-end">
          {inst?.sales_order_id && (
            <Tooltip title="Open workflow timeline">
              <Button size="small" component={RouterLink} to={`/workflow/${inst.sales_order_id}`}
                endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}>Open</Button>
            </Tooltip>
          )}
          {task.task_status !== 'completed' && (
            isManualStage(task.stage) ? (
              <Button size="small" variant="contained" color="success" disabled={busy}
                startIcon={<CheckCircleOutlineIcon sx={{ fontSize: 16 }} />}
                onClick={() => onComplete(task)}>Complete</Button>
            ) : (
              <Tooltip title="This stage advances automatically when the real action happens in its module.">
                <Chip size="small" color="warning" variant="outlined"
                  icon={<HourglassEmptyIcon sx={{ fontSize: 14 }} />}
                  label={waitingOn(task.stage) || 'Auto'} />
              </Tooltip>
            )
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

function Section({ title, tasks, color, onComplete, busyId }) {
  if (!tasks.length) return null;
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>
        <Chip size="small" label={tasks.length} color={color} />
      </Stack>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(min(100%,360px),1fr))' } }}>
        {tasks.map((t) => <TaskCard key={t.id} task={t} onComplete={onComplete} busy={busyId === t.id} />)}
      </Box>
    </Box>
  );
}

export default function DepartmentWorkboard() {
  const { employee, canManageTasks } = usePermissions();
  const myDept = employee?.department || '';
  const [dept, setDept] = useState(canManageTasks ? 'All' : (myDept || 'Production'));
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const filter = (canManageTasks && dept === 'All') ? {} : { department: dept };
      setTasks(await workflowEngineService.listWorkboardTasks(filter));
    } catch (e) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  }, [dept, canManageTasks]);

  useEffect(() => { load(); }, [load]);

  const complete = async (task) => {
    setBusyId(task.id); setError(null);
    try { await workflowEngineService.completeTask(task.id); await load(); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusyId(null); }
  };

  const groups = useMemo(() => groupByStatus(tasks), [tasks]);
  const open = tasks.filter((t) => t.task_status !== 'completed').length;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Box>
          <Typography variant="h5" fontWeight={700}>Department Workboard</Typography>
          <Typography variant="body2" color="text.secondary">
            Work the Order-to-Dispatch engine assigned to your department — {open} open
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {canManageTasks ? (
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Department</InputLabel>
            <Select label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
              <MenuItem value="All">All departments</MenuItem>
              {DEPARTMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
            </Select>
          </FormControl>
        ) : (
          <Chip label={myDept || 'My department'} />
        )}
        <Button startIcon={<RefreshIcon />} onClick={load} variant="outlined" size="small" disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && !tasks.length && (
        <Alert severity="info">No workflow tasks for this department right now.</Alert>
      )}

      <Stack spacing={3}>
        <Section title="Overdue" tasks={groups.overdue} color="error" onComplete={complete} busyId={busyId} />
        <Section title="Due today" tasks={groups.today} color="warning" onComplete={complete} busyId={busyId} />
        <Section title="Upcoming" tasks={groups.upcoming} color="info" onComplete={complete} busyId={busyId} />
        {!!groups.done.length && <Divider />}
        <Section title="Done" tasks={groups.done} color="success" onComplete={complete} busyId={busyId} />
      </Stack>
    </Box>
  );
}

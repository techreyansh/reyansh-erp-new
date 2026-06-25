import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import ReplayIcon from '@mui/icons-material/Replay';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionContext';
import LoadingScreen from '../common/LoadingScreen';
import AccessDenied from '../auth/AccessDenied';
import {
  appendMyTaskNote,
  isTaskOverdue,
  listMyTasks,
  rescheduleMyTask,
  updateMyTaskStatus,
} from '../../services/taskService';

const PRIORITY_COLOR = {
  high: 'error',
  medium: 'warning',
  low: 'info',
};

const DIFFICULTY_LABEL = {
  1: 'Small',
  2: 'Medium',
  3: 'Large',
};

function statusColor(status) {
  if (status === 'completed') return 'success';
  if (status === 'blocked') return 'error';
  if (status === 'in_progress') return 'info';
  return 'warning';
}

function statusLabel(status) {
  if (status === 'in_progress') return 'In progress';
  if (!status) return 'Pending';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Relative due-date label, e.g. "Overdue 2d", "Today", "in 3d", "Tue, 24 Jun". */
function relativeDue(dueDate) {
  if (!dueDate) return { text: 'No due date', tone: 'text.secondary' };
  const today = startOfToday();
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays < 0) {
    const n = Math.abs(diffDays);
    return { text: `Overdue ${n}d`, tone: 'error.main' };
  }
  if (diffDays === 0) return { text: 'Due today', tone: 'warning.main' };
  if (diffDays === 1) return { text: 'Due tomorrow', tone: 'info.main' };
  if (diffDays <= 7) return { text: `Due in ${diffDays}d`, tone: 'text.secondary' };
  return {
    text: due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    tone: 'text.secondary',
  };
}

function truncate(text, max = 160) {
  if (!text) return '';
  const clean = String(text);
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

/** Splits tasks into the inbox sections. */
function groupTasks(tasks) {
  const today = startOfToday();
  const overdue = [];
  const todayList = [];
  const upcoming = [];
  const done = [];

  for (const task of tasks) {
    if (task.task_status === 'completed') {
      done.push(task);
      continue;
    }
    if (isTaskOverdue(task)) {
      overdue.push(task);
      continue;
    }
    if (!task.due_date) {
      upcoming.push(task);
      continue;
    }
    const due = new Date(task.due_date);
    due.setHours(0, 0, 0, 0);
    if (due.getTime() === today.getTime()) todayList.push(task);
    else upcoming.push(task);
  }

  return { overdue, today: todayList, upcoming, done };
}

function TaskCard({ task, busyId, onStatus, onReschedule, onAddNote }) {
  const theme = useTheme();
  const busy = busyId === task.id;
  const due = relativeDue(task.due_date);
  const overdue = isTaskOverdue(task);
  const completed = task.task_status === 'completed';
  const priorityColor = PRIORITY_COLOR[task.priority] || 'default';
  const accent = overdue
    ? theme.palette.error.main
    : completed
    ? theme.palette.success.main
    : theme.palette.primary.main;

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2.5,
        borderLeft: `4px solid ${accent}`,
        height: '100%',
        opacity: completed ? 0.85 : 1,
        transition: 'box-shadow 0.2s ease',
        '&:hover': { boxShadow: `0 8px 22px -16px ${alpha(accent, 0.8)}` },
      }}
    >
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack spacing={1.25}>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700,
              lineHeight: 1.3,
              textDecoration: completed ? 'line-through' : 'none',
            }}
          >
            {task.title}
          </Typography>

          {task.description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}
            >
              {truncate(task.description)}
            </Typography>
          )}

          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
            <Chip
              size="small"
              label={`${(task.priority || 'medium')} priority`}
              color={priorityColor}
              variant={priorityColor === 'default' ? 'filled' : 'outlined'}
            />
            <Chip size="small" variant="outlined" label={DIFFICULTY_LABEL[task.difficulty] || 'Medium'} />
            <Chip size="small" label={statusLabel(task.task_status)} color={statusColor(task.task_status)} />
            <Typography variant="caption" sx={{ color: due.tone, fontWeight: 700, ml: 0.5 }}>
              {due.text}
            </Typography>
            {Number(task.reschedule_count) > 0 && (
              <Typography variant="caption" color="text.secondary">
                · rescheduled {task.reschedule_count}×
              </Typography>
            )}
          </Stack>

          <Divider sx={{ my: 0.25 }} />

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {task.task_status === 'pending' && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  disabled={busy}
                  onClick={() => onStatus(task, 'in_progress')}
                >
                  Accept &amp; Start
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  disabled={busy}
                  onClick={() => onStatus(task, 'completed')}
                >
                  Complete
                </Button>
              </>
            )}

            {task.task_status === 'in_progress' && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  disabled={busy}
                  onClick={() => onStatus(task, 'completed')}
                >
                  Complete
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<BlockIcon />}
                  disabled={busy}
                  onClick={() => onStatus(task, 'blocked')}
                >
                  Block
                </Button>
              </>
            )}

            {task.task_status === 'blocked' && (
              <Button
                size="small"
                variant="contained"
                startIcon={<ReplayIcon />}
                disabled={busy}
                onClick={() => onStatus(task, 'in_progress')}
              >
                Resume
              </Button>
            )}

            {!completed && (
              <Button
                size="small"
                variant="text"
                color="inherit"
                startIcon={<EventRepeatIcon />}
                disabled={busy}
                onClick={() => onReschedule(task)}
              >
                Reschedule
              </Button>
            )}

            <Button
              size="small"
              variant="text"
              color="inherit"
              startIcon={<NoteAddIcon />}
              disabled={busy}
              onClick={() => onAddNote(task)}
            >
              Proof / note
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function Section({ title, accent, tasks, defaultCollapsed = false, ...cardProps }) {
  const theme = useTheme();
  const [open, setOpen] = useState(!defaultCollapsed);
  if (!tasks.length) return null;
  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ cursor: 'pointer', mb: 1.5 }}
        onClick={() => setOpen((v) => !v)}
      >
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        <Chip
          size="small"
          label={tasks.length}
          sx={{
            fontWeight: 700,
            bgcolor: alpha(accent || theme.palette.primary.main, 0.14),
            color: accent || theme.palette.primary.main,
          }}
        />
        <Box sx={{ flexGrow: 1 }} />
        <IconButton size="small" aria-label="toggle section">
          <ExpandMoreIcon
            sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
          />
        </IconButton>
      </Stack>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' },
          }}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} {...cardProps} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function MyTasksView() {
  const theme = useTheme();
  const { user } = useAuth();
  const { employee, loading: permissionsLoading, authorized } = usePermissions();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  // Reschedule dialog
  const [rescheduleTask, setRescheduleTask] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleErr, setRescheduleErr] = useState('');

  // Note dialog
  const [noteTask, setNoteTask] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteErr, setNoteErr] = useState('');

  const employeeEmail = employee?.email || user?.email || '';

  const notify = (message, severity = 'success') =>
    setSnackbar({ open: true, message, severity });

  const loadTasks = async () => {
    if (!employeeEmail) return;
    try {
      const rows = await listMyTasks(employeeEmail);
      setTasks(rows);
    } catch (err) {
      notify(err.message || 'Failed to load your tasks.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (employeeEmail) {
      setLoading(true);
      void loadTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeEmail]);

  const grouped = useMemo(() => groupTasks(tasks), [tasks]);
  const openCount = grouped.overdue.length + grouped.today.length + grouped.upcoming.length;

  const handleStatus = async (task, nextStatus) => {
    setBusyId(task.id);
    // Optimistic UI
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, task_status: nextStatus } : t)));
    try {
      await updateMyTaskStatus(task.id, nextStatus, employeeEmail);
      await loadTasks();
      notify(`Task marked ${statusLabel(nextStatus).toLowerCase()}.`);
    } catch (err) {
      setTasks(prev);
      notify(err.message || 'Failed to update status.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openReschedule = (task) => {
    setRescheduleTask(task);
    setRescheduleDate(task.due_date || '');
    setRescheduleReason('');
    setRescheduleErr('');
  };

  const submitReschedule = async () => {
    if (!rescheduleReason.trim()) {
      setRescheduleErr('A reason is required.');
      return;
    }
    if (!rescheduleDate) {
      setRescheduleErr('Pick a new due date.');
      return;
    }
    const task = rescheduleTask;
    setBusyId(task.id);
    try {
      await rescheduleMyTask(task, rescheduleDate, rescheduleReason);
      setRescheduleTask(null);
      await loadTasks();
      notify('Task rescheduled. This affects your score.');
    } catch (err) {
      setRescheduleErr(err.message || 'Failed to reschedule.');
    } finally {
      setBusyId(null);
    }
  };

  const openNote = (task) => {
    setNoteTask(task);
    setNoteText('');
    setNoteErr('');
  };

  const submitNote = async () => {
    if (!noteText.trim()) {
      setNoteErr('Enter a note.');
      return;
    }
    const task = noteTask;
    setBusyId(task.id);
    try {
      await appendMyTaskNote(task, noteText);
      setNoteTask(null);
      await loadTasks();
      notify('Note added to task.');
    } catch (err) {
      setNoteErr(err.message || 'Failed to add note.');
    } finally {
      setBusyId(null);
    }
  };

  if (permissionsLoading) {
    return <LoadingScreen message="Loading your tasks…" />;
  }

  if (!authorized || !employee) {
    return <AccessDenied />;
  }

  const cardProps = {
    busyId,
    onStatus: handleStatus,
    onReschedule: openReschedule,
    onAddNote: openNote,
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 0, sm: 1 } }}>
      <Stack spacing={3}>
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              My Tasks
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Receive, accept, and act on the work assigned to you.
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {!loading && (
            <Stack direction="row" spacing={1}>
              <Chip
                icon={<TaskAltIcon />}
                label={`${openCount} open this week`}
                sx={{
                  fontWeight: 700,
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  color: theme.palette.primary.main,
                }}
              />
              {grouped.overdue.length > 0 && (
                <Chip color="error" label={`${grouped.overdue.length} overdue`} sx={{ fontWeight: 700 }} />
              )}
            </Stack>
          )}
        </Stack>

        {/* Loading skeleton */}
        {loading ? (
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' },
            }}
          >
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} variant="outlined" sx={{ borderRadius: 2.5 }}>
                <CardContent>
                  <Skeleton variant="text" width="70%" height={28} />
                  <Skeleton variant="text" width="100%" />
                  <Skeleton variant="text" width="90%" />
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Skeleton variant="rounded" width={80} height={24} />
                    <Skeleton variant="rounded" width={70} height={24} />
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>
        ) : tasks.length === 0 ? (
          <Card variant="outlined" sx={{ borderRadius: 2.5, textAlign: 'center', py: 6 }}>
            <CardContent>
              <TaskAltIcon sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                No tasks assigned — you&apos;re all clear
              </Typography>
              <Typography variant="body2" color="text.secondary">
                New work assigned to you will land in this inbox.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Stack spacing={4}>
            <Section
              title="🔴 Overdue"
              accent={theme.palette.error.main}
              tasks={grouped.overdue}
              {...cardProps}
            />
            <Section
              title="🟡 Today"
              accent={theme.palette.warning.main}
              tasks={grouped.today}
              {...cardProps}
            />
            <Section
              title="🔵 Upcoming"
              accent={theme.palette.info.main}
              tasks={grouped.upcoming}
              {...cardProps}
            />
            <Section
              title="✅ Done"
              accent={theme.palette.success.main}
              tasks={grouped.done}
              defaultCollapsed
              {...cardProps}
            />
          </Stack>
        )}
      </Stack>

      {/* Reschedule dialog */}
      <Dialog open={!!rescheduleTask} onClose={() => setRescheduleTask(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>Reschedule task</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Rescheduling logs a slip and <strong>affects your score</strong>. A reason is required.
          </DialogContentText>
          <Stack spacing={2}>
            <TextField
              label="New due date"
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="Reason (required)"
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              multiline
              minRows={2}
              required
              fullWidth
            />
            {rescheduleErr && <Alert severity="error">{rescheduleErr}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRescheduleTask(null)} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={submitReschedule}
            variant="contained"
            disabled={busyId === rescheduleTask?.id}
          >
            Reschedule
          </Button>
        </DialogActions>
      </Dialog>

      {/* Proof / note dialog */}
      <Dialog open={!!noteTask} onClose={() => setNoteTask(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>Add proof / note</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Add a completion note or proof link. It is appended to the task with today&apos;s date.
          </DialogContentText>
          <Stack spacing={2}>
            <TextField
              label="Note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              multiline
              minRows={3}
              autoFocus
              fullWidth
            />
            {noteErr && <Alert severity="error">{noteErr}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteTask(null)} color="inherit">
            Cancel
          </Button>
          <Button onClick={submitNote} variant="contained" disabled={busyId === noteTask?.id}>
            Save note
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default MyTasksView;

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { InboxOutlined } from '@mui/icons-material';
import taskComplianceService from '../../services/taskComplianceService';
import { useAuth } from '../../context/AuthContext';

const STATUS_COLOR = {
  pending: 'default',
  submitted: 'info',
  approved: 'success',
  rejected: 'error',
};

const TASK_TYPE_LABELS = {
  weekly_first_day: 'First working day of week',
  monthly_first_day: 'First working day of month',
};

const formatTaskType = (value) =>
  value ? TASK_TYPE_LABELS[value] || value : '-';

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '-');
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function EmployeeTaskChecklist() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [submissionLink, setSubmissionLink] = useState('');
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const loadTasks = async () => {
    if (!user?.email) return;
    setLoading(true);
    setError('');
    try {
      await taskComplianceService.generateForDate(selectedDate);
      let rows = await taskComplianceService.listTaskInstances({
        date: selectedDate,
        userEmail: user.email,
        includeTemplate: true,
      });
      // Fallback: show recent tasks for this user if selected date has no rows.
      if (rows.length === 0) {
        rows = await taskComplianceService.listTaskInstances({
          userEmail: user.email,
          includeTemplate: true,
        });
      }
      setTasks(rows);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Unable to load your checklist.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, [user?.email, selectedDate]);

  useEffect(() => {
    const unsubscribe = taskComplianceService.subscribeToTaskRealtime({
      onTaskChange: () => loadTasks(),
    });
    return unsubscribe;
  }, [user?.email]);

  const summary = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'approved').length;
    const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'rejected').length;
    return { total, completed, pending };
  }, [tasks]);

  const openSubmitDialog = (task) => {
    setSelectedTask(task);
    setSubmissionLink(task.submission_link || '');
    setSubmissionNotes(task.submission_notes || '');
    setProofFile(null);
    setDialogOpen(true);
  };

  const submitTask = async () => {
    if (!selectedTask) return;
    setError('');
    try {
      let link = submissionLink;
      if (proofFile) {
        setUploading(true);
        link = await taskComplianceService.uploadProofFile(
          selectedTask.id,
          user?.email,
          proofFile
        );
        setUploading(false);
      }
      await taskComplianceService.submitTask(selectedTask.id, {
        submissionLink: link,
        submissionNotes,
      });
      setDialogOpen(false);
      await loadTasks();
    } catch (e) {
      setUploading(false);
      setError(e?.message || 'Failed to submit task');
    }
  };

  const openProof = async (task) => {
    const url = await taskComplianceService.getProofSignedUrl(task.submission_link);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          Today&apos;s Checklist
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.6 }}>
          Total: {summary.total} | Completed: {summary.completed} | Pending: {summary.pending}
        </Typography>
      </Box>

      <TextField
        type="date"
        size="small"
        label="Task Date"
        value={selectedDate}
        onChange={(e) => setSelectedDate(e.target.value)}
        sx={{ maxWidth: 220 }}
        InputLabelProps={{ shrink: true }}
      />

      {error && <Alert severity="error">{error}</Alert>}

      <TableContainer
        component={Paper}
        elevation={2}
        sx={{
          maxHeight: { xs: 360, sm: 480 },
          borderRadius: 1,
          overflowX: 'auto',
          maxWidth: '100%',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <Table size="small" stickyHeader aria-label="Task checklist">
          <TableHead>
            <TableRow>
              <TableCell>Task</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Department</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Type</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Due</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton variant="text" height={22} sx={{ borderRadius: 0.5 }} />
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <Skeleton variant="text" height={22} sx={{ borderRadius: 0.5 }} />
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <Skeleton variant="text" height={22} sx={{ borderRadius: 0.5 }} />
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <Skeleton variant="text" height={22} sx={{ borderRadius: 0.5 }} />
                  </TableCell>
                  <TableCell>
                    <Skeleton variant="text" height={22} sx={{ borderRadius: 0.5 }} />
                  </TableCell>
                  <TableCell align="right">
                    <Skeleton variant="rounded" width={96} height={32} sx={{ borderRadius: 1, ml: 'auto' }} />
                  </TableCell>
                </TableRow>
              ))
            ) : tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, borderBottom: 'none' }}>
                  <Stack alignItems="center" spacing={1.5}>
                    <InboxOutlined sx={{ fontSize: 48, color: 'text.disabled' }} aria-hidden />
                    <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
                      No tasks available
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
                      Try another date or confirm your account is assigned tasks for this checklist.
                    </Typography>
                  </Stack>
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow
                  key={task.id}
                  hover
                  sx={(theme) => ({
                    '&:nth-of-type(even)': {
                      bgcolor: theme.palette.mode === 'dark' ? 'rgba(148, 163, 184, 0.08)' : theme.palette.grey[50],
                    },
                  })}
                >
                  <TableCell sx={{ py: 1.5 }}>{task.task_templates?.task_name || '-'}</TableCell>
                  <TableCell sx={{ py: 1.5, display: { xs: 'none', md: 'table-cell' } }}>
                    {task.task_templates?.department || '-'}
                  </TableCell>
                  <TableCell sx={{ py: 1.5, display: { xs: 'none', md: 'table-cell' } }}>
                    {formatTaskType(task.task_templates?.task_type)}
                  </TableCell>
                  <TableCell sx={{ py: 1.5, display: { xs: 'none', md: 'table-cell' } }}>
                    {formatDate(task.due_date)}
                  </TableCell>
                  <TableCell sx={{ py: 1.5 }}>
                    <Chip size="small" label={task.status} color={STATUS_COLOR[task.status] || 'default'} />
                  </TableCell>
                  <TableCell align="right" sx={{ py: 1.25 }}>
                    <Box
                      className="task-row-actions"
                      sx={{
                        display: 'inline-flex',
                        opacity: { xs: 1, sm: 0 },
                        transition: 'opacity 0.18s ease',
                        '.MuiTableRow-root:hover &': { opacity: 1 },
                      }}
                    >
                      <Stack direction="row" spacing={1}>
                        {task.submission_link && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => openProof(task)}
                          >
                            View Proof
                          </Button>
                        )}
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => openSubmitDialog(task)}
                          disabled={task.status === 'approved'}
                        >
                          Submit Proof
                        </Button>
                      </Stack>
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Submit Task Proof</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Proof Link (Drive / File URL)"
              value={submissionLink}
              onChange={(e) => setSubmissionLink(e.target.value)}
              fullWidth
            />
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Or upload a file (optional)
              </Typography>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                <Button
                  component="label"
                  variant="outlined"
                  size="small"
                  disabled={uploading}
                  startIcon={uploading ? <CircularProgress size={16} /> : undefined}
                >
                  {uploading ? 'Uploading…' : 'Choose File'}
                  <input
                    type="file"
                    hidden
                    onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                  />
                </Button>
                {proofFile && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ wordBreak: 'break-all' }}
                  >
                    {proofFile.name}
                  </Typography>
                )}
              </Stack>
            </Box>
            <TextField
              label="Notes"
              value={submissionNotes}
              onChange={(e) => setSubmissionNotes(e.target.value)}
              multiline
              minRows={3}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submitTask}
            disabled={uploading}
            startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {uploading ? 'Uploading…' : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

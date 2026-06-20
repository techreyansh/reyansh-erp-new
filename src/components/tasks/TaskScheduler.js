import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { usePermissions } from '../../context/PermissionContext';
import LoadingScreen from '../common/LoadingScreen';
import AccessDenied from '../auth/AccessDenied';
import { listEmployees } from '../../services/rbacService';
import { createTask } from '../../services/taskService';
import PersonPicker from './PersonPicker';

const emptyForm = {
  title: '',
  description: '',
  priority: 'medium',
  difficulty: 2,
  due_date: '',
};

// Priority pill colors mirror the rest of the tasks module (urgent/high = alarm,
// medium = warning, low = neutral).
const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'info' },
  { value: 'medium', label: 'Medium', color: 'warning' },
  { value: 'high', label: 'High', color: 'warning' },
  { value: 'urgent', label: 'Urgent', color: 'error' },
];

const DIFFICULTIES = [
  { value: 1, label: 'Small' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Large' },
];

function TaskScheduler() {
  const { employee, canCreate, loading: permissionsLoading, authorized } = usePermissions();
  const [person, setPerson] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [allEmployees, setAllEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Holds details of the most recently assigned task so we can show a success
  // panel with a one-tap manual WhatsApp send (interim, until auto-notify deploys).
  const [assigned, setAssigned] = useState(null);

  const canAssign = canCreate('tasks');
  const currentUserEmail = employee?.email || '';

  // Load active employees once so we can best-effort resolve the assigned_to FK
  // (employees.id) by email. assigned_email remains the source of truth; a null
  // assigned_to never blocks assignment.
  useEffect(() => {
    if (!canAssign) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listEmployees();
        if (!cancelled) setAllEmployees((rows || []).filter((row) => row.is_active));
      } catch (err) {
        console.warn('[TaskScheduler] Failed to load employees for id resolution:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canAssign]);

  const employeeIdByEmail = useMemo(() => {
    const map = new Map();
    allEmployees.forEach((row) => {
      if (row.email) map.set(String(row.email).trim().toLowerCase(), row.id);
    });
    return map;
  }, [allEmployees]);

  const canSubmit = Boolean(person?.email) && Boolean(form.title.trim()) && !saving;

  const handleAssign = async () => {
    setSaving(true);
    setError(null);
    setAssigned(null);
    try {
      if (!person?.email) throw new Error('Choose someone to assign the task to.');
      if (!form.title.trim()) throw new Error('Task title is required.');

      const assigneeEmail = String(person.email).trim().toLowerCase();
      const assigneeName = person.full_name || person.email;
      const taskTitle = form.title.trim();
      const dueLabel = form.due_date || 'no deadline set';

      // Best-effort employees.id FK; null is acceptable (assigned_email drives
      // EM scoring, RLS and notifications).
      const resolvedAssignedTo = employeeIdByEmail.get(assigneeEmail) || null;

      await createTask(
        {
          title: taskTitle,
          description: form.description,
          priority: form.priority,
          difficulty: form.difficulty,
          due_date: form.due_date,
          assigned_to: resolvedAssignedTo,
          assigned_email: assigneeEmail,
          assigned_name: assigneeName,
          department: person.department || null,
        },
        employee?.id
      );

      const message =
        `Hi ${assigneeName}, you have been assigned a task: "${taskTitle}" ` +
        `(priority ${form.priority}, due ${dueLabel}). Open the ERP to view.`;

      setAssigned({
        name: assigneeName,
        phone: person.phone || '',
        message,
      });
      setPerson(null);
      setForm(emptyForm);
    } catch (err) {
      setError(err.message || 'Failed to assign task.');
    } finally {
      setSaving(false);
    }
  };

  const handleSendWhatsApp = () => {
    if (!assigned?.phone) return;
    const digits = String(assigned.phone).replace(/\D/g, '');
    if (!digits) return;
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(assigned.message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
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
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Assign a task
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Search for a person, then set the task details. Their department and current workload show as you type.
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {assigned && (
          <Alert
            severity="success"
            icon={false}
            onClose={() => setAssigned(null)}
            sx={{ '& .MuiAlert-message': { width: '100%' } }}
          >
            <Stack spacing={1.5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Task assigned to {assigned.name}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                <Button
                  variant="contained"
                  color="success"
                  onClick={handleSendWhatsApp}
                  disabled={!assigned.phone}
                >
                  Send WhatsApp
                </Button>
                {!assigned.phone && (
                  <Typography variant="caption" color="text.secondary">
                    No phone number on file for this person.
                  </Typography>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Email + WhatsApp auto-send activates once notifications are deployed.
              </Typography>
            </Stack>
          </Alert>
        )}

        <Card>
          <CardContent>
            <Stack spacing={3}>
              <PersonPicker
                label="Assign to"
                value={person}
                onChange={setPerson}
                currentUserEmail={currentUserEmail}
              />

              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    label="Task title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    fullWidth
                    required
                    placeholder="A short, clear summary of what needs to be done"
                  />
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                    Priority
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    value={form.priority}
                    onChange={(e, v) => v && setForm({ ...form, priority: v })}
                    size="small"
                    sx={{ flexWrap: 'wrap', gap: 1, '& .MuiToggleButton-root': { borderRadius: 999, px: 2 } }}
                  >
                    {PRIORITIES.map((p) => (
                      <ToggleButton key={p.value} value={p.value} color={p.color}>
                        {p.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    label="Due date"
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    helperText="Optional"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                    Difficulty
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    value={form.difficulty}
                    onChange={(e, v) => v && setForm({ ...form, difficulty: v })}
                    size="small"
                    sx={{ flexWrap: 'wrap', gap: 1, '& .MuiToggleButton-root': { borderRadius: 999, px: 2 } }}
                  >
                    {DIFFICULTIES.map((d) => (
                      <ToggleButton key={d.value} value={d.value}>
                        {d.value} · {d.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="Description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    fullWidth
                    multiline
                    minRows={3}
                    placeholder="Add any context, links or acceptance criteria (optional)"
                  />
                </Grid>
              </Grid>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  size="large"
                  onClick={() => void handleAssign()}
                  disabled={!canSubmit}
                  sx={{ px: 4, fontWeight: 700 }}
                >
                  {saving ? 'Assigning…' : 'Assign task'}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

export default TaskScheduler;

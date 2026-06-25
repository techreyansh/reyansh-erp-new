import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add, EditOutlined, InboxOutlined, PlayArrowOutlined } from '@mui/icons-material';
import taskComplianceService from '../../services/taskComplianceService';
import { listRoles, listEmployees } from '../../services/rbacService';

const DEPARTMENTS = ['CRM', 'PPC', 'Production', 'Quality', 'Dispatch'];

// Frequency options (maps to task_templates.task_type). `label` is shown in the
// Select and the table chip; values with no entry fall back to a capitalized value.
const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'weekly_first_day', label: 'First working day of week' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'monthly_first_day', label: 'First working day of month' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'custom', label: 'Custom (every N…)' },
];

// Unit options for a custom (every N units) cadence.
const RECURRENCE_UNITS = [
  { value: 'day', label: 'Day(s)' },
  { value: 'week', label: 'Week(s)' },
  { value: 'month', label: 'Month(s)' },
];

const FREQUENCY_LABEL = FREQUENCIES.reduce((acc, f) => {
  acc[f.value] = f.label;
  return acc;
}, {});

const FREQUENCY_COLOR = {
  daily: 'success',
  weekly: 'info',
  weekly_first_day: 'primary',
  monthly: 'warning',
  monthly_first_day: 'secondary',
  quarterly: 'secondary',
  custom: 'default',
};

// Human label for a custom cadence, e.g. "Every 2 week(s)".
const customFrequencyLabel = (row) => {
  const interval = row.recurrence_interval != null ? Number(row.recurrence_interval) : 1;
  const unit = row.recurrence_unit || 'day';
  return `Every ${interval} ${unit}(s)`;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  task_name: '',
  description: '',
  department: '',
  task_type: '',
  start_date: '',
  recurrence_unit: '',
  recurrence_interval: 1,
  assigneeMode: 'role', // 'role' | 'person'
  assigned_role_code: '',
  assigned_email: '',
  scoring_weight: 1,
  required_proof: false,
  is_active: true,
};

export default function ChecklistTemplateAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const [roles, setRoles] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [genDate, setGenDate] = useState(todayIso());
  const [generating, setGenerating] = useState(false);

  const notify = (message, severity = 'success') =>
    setSnackbar({ open: true, message, severity });

  const loadTemplates = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await taskComplianceService.listTemplates();
      setRows(data);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Failed to load checklist templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [r, emp] = await Promise.all([listRoles(), listEmployees()]);
        if (!active) return;
        setRoles(r);
        setEmployees(emp);
      } catch (e) {
        console.error('Failed to load roles/employees', e);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const roleLabelByCode = useMemo(() => {
    const map = {};
    roles.forEach((r) => {
      if (r.code) map[r.code] = r.role_name || r.name || r.code;
    });
    return map;
  }, [roles]);

  const assigneeLabel = (row) => {
    if (row.assigned_email) return row.assigned_email;
    if (row.assigned_role_code) {
      const label = roleLabelByCode[row.assigned_role_code];
      return label ? `${label} (${row.assigned_role_code})` : row.assigned_role_code;
    }
    if (row.assigned_user_id) return 'User assigned';
    return '-';
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      task_name: row.task_name || '',
      description: row.description || '',
      department: row.department || '',
      task_type: row.task_type || '',
      start_date: row.start_date || '',
      recurrence_unit: row.recurrence_unit || '',
      recurrence_interval: row.recurrence_interval != null ? Number(row.recurrence_interval) : 1,
      assigneeMode: row.assigned_email ? 'person' : 'role',
      assigned_role_code: row.assigned_role_code || '',
      assigned_email: row.assigned_email || '',
      scoring_weight: row.scoring_weight != null ? Number(row.scoring_weight) : 1,
      required_proof: Boolean(row.required_proof),
      is_active: row.is_active !== false,
    });
    setFormError('');
    setDialogOpen(true);
  };

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const validateForm = () => {
    if (!form.task_name.trim()) return 'Task name is required.';
    if (!form.department) return 'Department is required.';
    if (!form.task_type) return 'Frequency is required.';
    if (form.task_type === 'custom') {
      if (!form.start_date) return 'Start date is required for a custom cadence.';
      if (!form.recurrence_unit) return 'Choose a recurrence unit for the custom cadence.';
      if (!(Number(form.recurrence_interval) >= 1))
        return 'Recurrence interval must be 1 or greater.';
    }
    const hasAssignee =
      (form.assigneeMode === 'role' && form.assigned_role_code) ||
      (form.assigneeMode === 'person' && form.assigned_email);
    if (!hasAssignee) return 'Assign the task to a role or a person.';
    if (form.scoring_weight === '' || Number(form.scoring_weight) < 0)
      return 'Scoring weight must be 0 or greater.';
    return '';
  };

  const handleSave = async () => {
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setFormError('');

    const isRole = form.assigneeMode === 'role';
    const isCustom = form.task_type === 'custom';
    const payload = {
      task_name: form.task_name.trim(),
      description: form.description.trim() || null,
      department: form.department,
      task_type: form.task_type,
      start_date: form.start_date ? form.start_date : null,
      recurrence_unit: isCustom ? form.recurrence_unit || null : null,
      recurrence_interval: Number(form.recurrence_interval) || 1,
      assigned_role_code: isRole ? form.assigned_role_code : null,
      assigned_email: isRole ? null : form.assigned_email,
      assigned_user_id: null,
      required_proof: form.required_proof,
      scoring_weight: Number(form.scoring_weight),
      is_active: form.is_active,
    };

    try {
      if (editingId) {
        await taskComplianceService.updateTemplate(editingId, payload);
        notify('Template updated.');
      } else {
        await taskComplianceService.createTemplate(payload);
        notify('Template created.');
      }
      setDialogOpen(false);
      await loadTemplates();
    } catch (e) {
      console.error(e);
      setFormError(e?.message || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (row, nextActive) => {
    // Optimistic update.
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, is_active: nextActive } : r))
    );
    try {
      await taskComplianceService.setTemplateActive(row.id, nextActive);
      notify(nextActive ? 'Template activated.' : 'Template deactivated.');
    } catch (e) {
      console.error(e);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, is_active: !nextActive } : r))
      );
      notify(e?.message || 'Failed to update status.', 'error');
    }
  };

  const handleGenerate = async () => {
    if (!genDate) return;
    setGenerating(true);
    try {
      const result = await taskComplianceService.generateInstances(genDate);
      const count = typeof result === 'number' ? result : Number(result);
      if (Number.isFinite(count)) {
        notify(`Generated ${count} task instance${count === 1 ? '' : 's'} for ${genDate}.`);
      } else {
        notify(`Instances generated for ${genDate}.`);
      }
    } catch (e) {
      console.error(e);
      notify(e?.message || 'Failed to generate instances.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Stack spacing={3} sx={{ width: '100%', minWidth: 0 }}>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          Checklist Templates
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.6 }}>
          Define recurring checklist tasks that feed the Executive Meeting checklist score.
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Paper elevation={2} sx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', md: 'center' }}
          justifyContent="space-between"
        >
          <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
            New Template
          </Button>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <TextField
              type="date"
              size="small"
              label="Instance date"
              value={genDate}
              onChange={(e) => setGenDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 180 }}
            />
            <Button
              variant="outlined"
              startIcon={<PlayArrowOutlined />}
              onClick={handleGenerate}
              disabled={generating || !genDate}
            >
              {generating ? 'Generating…' : 'Generate Instances'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <TableContainer
        component={Paper}
        elevation={2}
        sx={{
          maxHeight: { xs: 420, sm: 560 },
          borderRadius: 1,
          overflowX: 'auto',
          maxWidth: '100%',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <Table size="small" stickyHeader aria-label="Checklist templates">
          <TableHead>
            <TableRow>
              <TableCell>Task name</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Department</TableCell>
              <TableCell>Frequency</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Assigned to</TableCell>
              <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                Weight
              </TableCell>
              <TableCell align="center" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                Proof
              </TableCell>
              <TableCell align="center">Active</TableCell>
              <TableCell align="right">Edit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => (
                <TableRow key={i}>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((c) => (
                    <TableCell key={c}>
                      <Skeleton variant="text" height={22} sx={{ borderRadius: 0.5 }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, borderBottom: 'none' }}>
                  <Stack alignItems="center" spacing={1.5}>
                    <InboxOutlined sx={{ fontSize: 48, color: 'text.disabled' }} aria-hidden />
                    <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
                      No checklist templates yet
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
                      Create a template to start scoring recurring accountability tasks.
                    </Typography>
                  </Stack>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  sx={(theme) => ({
                    '&:nth-of-type(even)': {
                      bgcolor:
                        theme.palette.mode === 'dark'
                          ? 'rgba(148, 163, 184, 0.08)'
                          : theme.palette.grey[50],
                    },
                    opacity: row.is_active === false ? 0.6 : 1,
                  })}
                >
                  <TableCell sx={{ py: 1.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {row.task_name}
                    </Typography>
                    {row.description ? (
                      <Typography variant="caption" color="text.secondary">
                        {row.description}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell sx={{ py: 1.5, display: { xs: 'none', md: 'table-cell' } }}>
                    {row.department || '-'}
                  </TableCell>
                  <TableCell sx={{ py: 1.5 }}>
                    <Chip
                      size="small"
                      label={
                        row.task_type === 'custom'
                          ? customFrequencyLabel(row)
                          : FREQUENCY_LABEL[row.task_type] || row.task_type
                      }
                      color={FREQUENCY_COLOR[row.task_type] || 'default'}
                      sx={
                        FREQUENCY_LABEL[row.task_type] || row.task_type === 'custom'
                          ? undefined
                          : { textTransform: 'capitalize' }
                      }
                    />
                    {row.start_date ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        From {row.start_date}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell sx={{ py: 1.5, display: { xs: 'none', md: 'table-cell' } }}>
                    {assigneeLabel(row)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ py: 1.5, display: { xs: 'none', sm: 'table-cell' } }}
                  >
                    {row.scoring_weight ?? 1}
                  </TableCell>
                  <TableCell
                    align="center"
                    sx={{ py: 1.5, display: { xs: 'none', sm: 'table-cell' } }}
                  >
                    {row.required_proof ? '✓' : '—'}
                  </TableCell>
                  <TableCell align="center" sx={{ py: 0.5 }}>
                    <Switch
                      size="small"
                      checked={row.is_active !== false}
                      onChange={(e) => handleToggleActive(row, e.target.checked)}
                      inputProps={{ 'aria-label': `Toggle active for ${row.task_name}` }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ py: 0.5 }}>
                    <Tooltip title="Edit template">
                      <IconButton size="small" onClick={() => openEdit(row)} aria-label="Edit template">
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingId ? 'Edit Template' : 'New Template'}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              label="Task name"
              required
              value={form.task_name}
              onChange={(e) => setField('task_name', e.target.value)}
              fullWidth
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1fr) minmax(0,1fr)' },
                gap: 2,
              }}
            >
              <FormControl fullWidth required>
                <InputLabel>Department</InputLabel>
                <Select
                  value={form.department}
                  label="Department"
                  onChange={(e) => setField('department', e.target.value)}
                >
                  {DEPARTMENTS.map((d) => (
                    <MenuItem key={d} value={d}>
                      {d}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth required>
                <InputLabel>Frequency</InputLabel>
                <Select
                  value={form.task_type}
                  label="Frequency"
                  onChange={(e) => setField('task_type', e.target.value)}
                >
                  {FREQUENCIES.map((f) => (
                    <MenuItem key={f.value} value={f.value}>
                      {f.label}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  First working day = the period's first weekday (Mon for week; 1st working day for
                  month).
                </FormHelperText>
              </FormControl>
            </Box>

            <TextField
              type="date"
              label="Start date (optional)"
              required={form.task_type === 'custom'}
              value={form.start_date}
              onChange={(e) => setField('start_date', e.target.value)}
              InputLabelProps={{ shrink: true }}
              helperText={
                form.task_type === 'custom'
                  ? 'A custom cadence is anchored to this date — required.'
                  : 'Leave blank to start immediately.'
              }
              fullWidth
            />

            {form.task_type === 'custom' ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'auto minmax(0,120px) minmax(0,1fr)' },
                  gap: 1.5,
                  alignItems: 'center',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Every
                </Typography>
                <TextField
                  label="Interval"
                  type="number"
                  value={form.recurrence_interval}
                  onChange={(e) => setField('recurrence_interval', e.target.value)}
                  inputProps={{ min: 1, step: 1 }}
                  fullWidth
                />
                <FormControl fullWidth required>
                  <InputLabel>Unit</InputLabel>
                  <Select
                    value={form.recurrence_unit}
                    label="Unit"
                    onChange={(e) => setField('recurrence_unit', e.target.value)}
                  >
                    {RECURRENCE_UNITS.map((u) => (
                      <MenuItem key={u.value} value={u.value}>
                        {u.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            ) : null}

            <Divider flexItem>
              <Typography variant="caption" color="text.secondary">
                Assign to
              </Typography>
            </Divider>

            <ToggleButtonGroup
              size="small"
              exclusive
              value={form.assigneeMode}
              onChange={(e, val) => {
                if (!val) return;
                setForm((prev) => ({
                  ...prev,
                  assigneeMode: val,
                  assigned_role_code: val === 'role' ? prev.assigned_role_code : '',
                  assigned_email: val === 'person' ? prev.assigned_email : '',
                }));
              }}
              fullWidth
            >
              <ToggleButton value="role">Role</ToggleButton>
              <ToggleButton value="person">Person</ToggleButton>
            </ToggleButtonGroup>

            {form.assigneeMode === 'role' ? (
              <FormControl fullWidth>
                <InputLabel>Role</InputLabel>
                <Select
                  value={form.assigned_role_code}
                  label="Role"
                  onChange={(e) => setField('assigned_role_code', e.target.value)}
                >
                  {roles
                    .filter((r) => r.code)
                    .map((r) => (
                      <MenuItem key={r.id || r.code} value={r.code}>
                        {(r.role_name || r.name || r.code)} ({r.code})
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            ) : (
              <Autocomplete
                options={employees.filter((emp) => emp.email)}
                getOptionLabel={(opt) =>
                  opt?.full_name ? `${opt.full_name} — ${opt.email}` : opt?.email || ''
                }
                isOptionEqualToValue={(opt, val) => opt.email === val.email}
                value={employees.find((emp) => emp.email === form.assigned_email) || null}
                onChange={(e, val) => setField('assigned_email', val?.email || '')}
                renderInput={(params) => <TextField {...params} label="Person (email)" />}
                fullWidth
              />
            )}

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1fr) minmax(0,1fr)' },
                gap: 2,
                alignItems: 'center',
              }}
            >
              <TextField
                label="Scoring weight"
                type="number"
                value={form.scoring_weight}
                onChange={(e) => setField('scoring_weight', e.target.value)}
                inputProps={{ min: 0, step: 0.5 }}
                fullWidth
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.required_proof}
                    onChange={(e) => setField('required_proof', e.target.checked)}
                  />
                }
                label="Requires proof"
              />
            </Box>

            {editingId ? (
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={(e) => setField('is_active', e.target.checked)}
                  />
                }
                label="Active"
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={
              saving ||
              (form.task_type === 'custom' && (!form.start_date || !form.recurrence_unit))
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
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
    </Stack>
  );
}

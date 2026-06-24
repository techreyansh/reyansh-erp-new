import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField, MenuItem,
  CircularProgress, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip,
  Divider, useTheme,
} from '@mui/material';
import {
  EventNote as PlanIcon, Add as AddIcon, Refresh as RefreshIcon, DeleteOutline as DelIcon,
} from '@mui/icons-material';
import mesMasterService from '../../services/mesMasterService';

const PRIORITY_COLOR = { urgent: 'error', high: 'warning', normal: 'default', low: 'info' };
const STATUS_COLOR = { planned: 'default', in_production: 'primary', done: 'success', cancelled: 'warning' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');

const DailyPlan = () => {
  const theme = useTheme();
  const [plans, setPlans] = useState([]);
  const [depts, setDepts] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d, s] = await Promise.all([
        mesMasterService.listRows('daily_production_plan', { orderBy: 'plan_date', ascending: true }),
        mesMasterService.listRows('department'), mesMasterService.listRows('shift_master'),
      ]);
      setPlans(p); setDepts(d); setShifts(s);
    } catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const deptName = useMemo(() => Object.fromEntries(depts.map((d) => [d.id, d.name])), [depts]);
  const shiftName = useMemo(() => Object.fromEntries(shifts.map((s) => [s.id, s.name])), [shifts]);

  const byDate = useMemo(() => {
    const m = {};
    plans.forEach((p) => { const k = p.plan_date || 'Unscheduled'; (m[k] = m[k] || []).push(p); });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [plans]);

  const del = async (id) => {
    try { await mesMasterService.deleteRow('daily_production_plan', id); await load(); }
    catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.secondary.main} 0%, ${theme.palette.secondary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <PlanIcon sx={{ fontSize: 32 }} />
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Daily Production Plan</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>What runs, where, and on which shift.</Typography></Box>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setEditing({ plan_date: new Date().toISOString().slice(0, 10), priority: 'normal' })} startIcon={<AddIcon />} variant="contained" color="inherit" sx={{ color: theme.palette.secondary.main }}>Add plan</Button>
            <Tooltip title="Refresh"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
          </Stack>
        </CardContent>
      </Card>

      {loading ? <Box sx={{ textAlign: 'center', py: 8 }}><CircularProgress /></Box> : byDate.length === 0 ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 6 }}>
          <PlanIcon sx={{ fontSize: 44, color: 'text.disabled', mb: 1 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Nothing planned yet</Typography>
          <Typography variant="body2" color="text.secondary">Add a plan to allocate a product to a day, department and shift.</Typography>
        </CardContent></Card>
      ) : (
        <Stack spacing={2}>
          {byDate.map(([date, items]) => (
            <Card key={date} sx={{ borderRadius: 2 }}><CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{fmtDate(date)} <Typography component="span" variant="caption" color="text.secondary">· {items.length} job(s) · {items.reduce((s, i) => s + (Number(i.planned_qty) || 0), 0)} pcs</Typography></Typography>
              <Divider sx={{ mb: 1 }} />
              <Stack spacing={1}>
                {items.map((p) => (
                  <Stack key={p.id} direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 160 }}>{p.product_name || '—'}</Typography>
                    <Chip size="small" label={`${p.planned_qty || 0} pcs`} sx={{ height: 20 }} />
                    {p.department_id && <Chip size="small" variant="outlined" label={deptName[p.department_id] || 'dept'} sx={{ height: 20 }} />}
                    {p.shift_id && <Chip size="small" variant="outlined" label={shiftName[p.shift_id] || 'shift'} sx={{ height: 20 }} />}
                    {p.manpower_assigned ? <Typography variant="caption" color="text.secondary">{p.manpower_assigned} men</Typography> : null}
                    {p.priority && p.priority !== 'normal' && <Chip size="small" label={p.priority} color={PRIORITY_COLOR[p.priority]} sx={{ height: 20 }} />}
                    <Chip size="small" label={p.status} color={STATUS_COLOR[p.status]} sx={{ height: 20 }} />
                    <Box sx={{ flexGrow: 1 }} />
                    <IconButton size="small" color="error" onClick={() => del(p.id)}><DelIcon fontSize="small" /></IconButton>
                  </Stack>
                ))}
              </Stack>
            </CardContent></Card>
          ))}
        </Stack>
      )}

      <PlanDialog plan={editing} depts={depts} shifts={shifts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} notify={setSnackbar} />
      <Snackbar open={snackbar.open} autoHideDuration={3500} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

function PlanDialog({ plan, depts, shifts, onClose, onSaved, notify }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (plan) setForm({ priority: 'normal', status: 'planned', ...plan }); }, [plan]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    if (!form.product_name?.trim()) { notify({ open: true, message: 'Product is required.', severity: 'warning' }); return; }
    if (!form.plan_date) { notify({ open: true, message: 'Date is required.', severity: 'warning' }); return; }
    setSaving(true);
    try {
      await mesMasterService.saveRow('daily_production_plan', {
        ...form, planned_qty: form.planned_qty ? Number(form.planned_qty) : null,
        manpower_assigned: form.manpower_assigned ? Number(form.manpower_assigned) : null,
      });
      notify({ open: true, message: 'Plan saved.', severity: 'success' }); onSaved();
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setSaving(false);
  };
  return (
    <Dialog open={!!plan} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{plan?.id ? 'Edit plan' : 'New production plan'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Product" value={form.product_name || ''} onChange={set('product_name')} fullWidth autoFocus />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField type="date" label="Date" value={form.plan_date || ''} onChange={set('plan_date')} fullWidth InputLabelProps={{ shrink: true }} />
            <TextField type="number" label="Quantity" value={form.planned_qty ?? ''} onChange={set('planned_qty')} fullWidth />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Department" value={form.department_id || ''} onChange={set('department_id')} fullWidth>
              <MenuItem value="">—</MenuItem>{depts.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
            </TextField>
            <TextField select label="Shift" value={form.shift_id || ''} onChange={set('shift_id')} fullWidth>
              <MenuItem value="">—</MenuItem>{shifts.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField type="number" label="Manpower" value={form.manpower_assigned ?? ''} onChange={set('manpower_assigned')} fullWidth />
            <TextField select label="Priority" value={form.priority || 'normal'} onChange={set('priority')} fullWidth>
              {['low', 'normal', 'high', 'urgent'].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField select label="Status" value={form.status || 'planned'} onChange={set('status')} fullWidth>
              {['planned', 'in_production', 'done', 'cancelled'].map((s) => <MenuItem key={s} value={s}>{s.replace('_', ' ')}</MenuItem>)}
            </TextField>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} variant="contained" color="secondary" disabled={saving}>{saving ? <CircularProgress size={20} /> : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  );
}

export default DailyPlan;

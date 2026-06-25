import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Box, Typography,
  TextField, MenuItem, Checkbox, FormControlLabel, Chip, Divider, LinearProgress,
  CircularProgress, Alert, Tooltip,
} from '@mui/material';
import { AutoFixHigh as AutoIcon, WarningAmber as WarnIcon } from '@mui/icons-material';
import mesMasterService from '../../services/mesMasterService';
import * as productionDemandService from '../../services/productionDemandService';
import { moldingPoolPerHour, buildWorkingDays, autoPlan } from '../../services/autoPlanner';

const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
const num = (x) => Number(x) || 0;

/**
 * Auto-plan dialog: pulls open production demand, sizes the shared molding pool
 * from molding_master, runs the pure due-date allocator, shows a preview the
 * planner can trim, then commits the whole set atomically (mes_auto_commit_plan).
 */
export default function AutoPlanDialog({ open, onClose, depts = [], shifts = [], onCommitted, notify }) {
  const [demands, setDemands] = useState([]);
  const [molds, setMolds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [excluded, setExcluded] = useState({}); // demand_id -> true
  const [horizon, setHorizon] = useState(14);
  const [shiftHours, setShiftHours] = useState(8);
  const [skipSundays, setSkipSundays] = useState(true);
  const [deptId, setDeptId] = useState('');
  const [shiftId, setShiftId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dem, md] = await Promise.all([
        productionDemandService.listDemand(),
        mesMasterService.listRows('molding_master'),
      ]);
      const open = (dem || []).filter((d) => ['pending', 'planned'].includes(d.status) && num(d.qty) - num(d.planned_qty) > 0);
      setDemands(open);
      setMolds(md || []);
      setExcluded({});
    } catch (e) { notify?.({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }, [notify]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // sensible defaults once masters are present
  useEffect(() => {
    if (!open) return;
    if (!deptId && depts.length) {
      const mold = depts.find((d) => /mold/i.test(d.name || '')) || depts[0];
      setDeptId(mold?.id || '');
    }
    if (!shiftId && shifts.length) {
      setShiftId(shifts[0].id);
      if (shifts[0].shift_hours) setShiftHours(num(shifts[0].shift_hours));
    }
  }, [open, depts, shifts, deptId, shiftId]);

  const poolPerHour = useMemo(() => moldingPoolPerHour(molds), [molds]);
  const activeMolds = useMemo(() => molds.filter((m) => (m.status || 'active') === 'active' && num(m.cycle_time_sec) > 0).length, [molds]);
  const poolPerDay = useMemo(() => Math.floor(poolPerHour * num(shiftHours)), [poolPerHour, shiftHours]);

  const included = useMemo(() => demands.filter((d) => !excluded[d.id]), [demands, excluded]);

  const plan = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const workingDays = buildWorkingDays(today, Math.max(1, num(horizon)), { skipSundays });
    return autoPlan({ demands: included, poolPerDay, workingDays });
  }, [included, poolPerDay, horizon, skipSundays]);

  const rowsByDate = useMemo(() => {
    const m = {};
    plan.rows.forEach((r) => { (m[r.plan_date] = m[r.plan_date] || []).push(r); });
    const capByDate = Object.fromEntries(plan.perDay.map((d) => [d.date, d]));
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])).map(([date, rows]) => ({ date, rows, day: capByDate[date] }));
  }, [plan]);

  const commit = async () => {
    if (!plan.rows.length) return;
    setCommitting(true);
    try {
      const payload = plan.rows.map((r) => ({
        demand_id: r.demand_id,
        product_id: r.product_id,
        product_name: r.product_name,
        planned_qty: r.planned_qty,
        plan_date: r.plan_date,
        priority: r.priority,
        department_id: deptId || null,
        shift_id: shiftId || null,
        notes: `auto-planned${r.so_number ? ` from ${r.so_number}` : ''}${r.late ? ' (LATE)' : ''}`,
      }));
      const res = await mesMasterService.autoCommitPlan(payload);
      if (res && res.ok === false) { notify?.({ open: true, message: res.message, severity: 'warning' }); }
      else {
        notify?.({ open: true, message: `Committed ${res.plans_created} plan rows across ${rowsByDate.length} day(s).`, severity: 'success' });
        onCommitted?.();
        onClose?.();
      }
    } catch (e) { notify?.({ open: true, message: e.message, severity: 'error' }); }
    setCommitting(false);
  };

  return (
    <Dialog open={open} onClose={committing ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoIcon color="secondary" /> Auto-plan from demand
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <Stack spacing={2}>
            {/* Capacity + settings */}
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Molding pool: {poolPerHour.toLocaleString()} pcs/hr × {num(shiftHours)}h = <b>{poolPerDay.toLocaleString()} pcs/day</b>
                <Typography component="span" variant="caption" color="text.secondary"> · from {activeMolds} active mold(s)</Typography>
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
                <TextField type="number" size="small" label="Horizon (days)" value={horizon} onChange={(e) => setHorizon(e.target.value)} sx={{ width: 140 }} />
                <TextField type="number" size="small" label="Shift hours" value={shiftHours} onChange={(e) => setShiftHours(e.target.value)} sx={{ width: 140 }} />
                <TextField select size="small" label="Department" value={deptId} onChange={(e) => setDeptId(e.target.value)} sx={{ width: 180 }}>
                  <MenuItem value="">—</MenuItem>{depts.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)} sx={{ width: 160 }}>
                  <MenuItem value="">—</MenuItem>{shifts.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                </TextField>
                <FormControlLabel control={<Checkbox checked={skipSundays} onChange={(e) => setSkipSundays(e.target.checked)} />} label="Skip Sundays" />
              </Stack>
            </Box>

            {poolPerDay <= 0 && (
              <Alert severity="warning">No molding capacity — add active molds (with a cycle time) in MES Setup, or set shift hours above zero.</Alert>
            )}
            {demands.length === 0 && (
              <Alert severity="info">No open production demand. Release a sales order to generate demand first.</Alert>
            )}

            {/* Demand picker */}
            {demands.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Open demand ({included.length}/{demands.length} included)</Typography>
                <Stack spacing={0.5}>
                  {demands.map((d) => {
                    const remaining = num(d.qty) - num(d.planned_qty);
                    return (
                      <Stack key={d.id} direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                        <Checkbox size="small" checked={!excluded[d.id]} onChange={(e) => setExcluded((x) => ({ ...x, [d.id]: !e.target.checked }))} sx={{ p: 0.5 }} />
                        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 150 }}>{d.product_name || d.product_code || '—'}</Typography>
                        <Chip size="small" label={`${remaining.toLocaleString()} pcs`} sx={{ height: 20 }} />
                        <Typography variant="caption" color="text.secondary">due {fmtDate(d.required_date)}</Typography>
                        {d.so_number && <Typography variant="caption" color="text.secondary">· {d.so_number}</Typography>}
                        {d.priority && d.priority !== 'normal' && d.priority !== 'medium' && <Chip size="small" label={d.priority} sx={{ height: 20 }} />}
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>
            )}

            {/* Preview */}
            {plan.rows.length > 0 && (
              <Box>
                <Divider sx={{ mb: 1 }} />
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Proposed plan — {plan.rows.length} row(s) over {rowsByDate.length} day(s)</Typography>
                  {plan.lateCount > 0 && <Chip size="small" color="error" icon={<WarnIcon />} label={`${plan.lateCount} late`} sx={{ height: 22 }} />}
                  {plan.unplanned > 0 && <Tooltip title="Increase the horizon or molding capacity to fit these"><Chip size="small" color="warning" label={`${plan.unplanned.toLocaleString()} pcs unplanned`} sx={{ height: 22 }} /></Tooltip>}
                </Stack>
                <Stack spacing={1.5}>
                  {rowsByDate.map(({ date, rows, day }) => {
                    const pct = day && day.capacity > 0 ? Math.min(100, Math.round((day.used / day.capacity) * 100)) : 0;
                    return (
                      <Box key={date}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmtDate(date)}</Typography>
                          <Typography variant="caption" color="text.secondary">{day?.used.toLocaleString()} / {day?.capacity.toLocaleString()} pcs ({pct}%)</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3, my: 0.5 }} />
                        <Stack spacing={0.25} sx={{ pl: 1 }}>
                          {rows.map((r, i) => (
                            <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                              <Typography variant="body2" sx={{ minWidth: 150 }}>{r.product_name || '—'}</Typography>
                              <Chip size="small" label={`${r.planned_qty.toLocaleString()} pcs`} sx={{ height: 20 }} />
                              {r.late && <Chip size="small" color="error" label={`late · due ${fmtDate(r.required_date)}`} sx={{ height: 20 }} />}
                            </Stack>
                          ))}
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={committing}>Cancel</Button>
        <Button onClick={commit} variant="contained" color="secondary" disabled={committing || plan.rows.length === 0}
          startIcon={committing ? <CircularProgress size={16} color="inherit" /> : <AutoIcon />}>
          {committing ? 'Committing…' : `Commit ${plan.rows.length} plan row(s)`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
